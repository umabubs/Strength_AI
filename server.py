"""Run the My Strength AI prototype on a local, separate origin."""
from argparse import ArgumentParser
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
import json
from pathlib import Path
import re
import shutil
import subprocess
from threading import BoundedSemaphore
from urllib.parse import urlsplit

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageOps, UnidentifiedImageError

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
MACHINES = json.loads((PUBLIC / "machines.json").read_text())
MAX_UPLOAD = 4 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 12_000_000
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)
UNKNOWN = [
    "a person or a selfie", "a bedroom or living room with furniture",
    "a domestic object, animal, landscape, vehicle or unrelated image",
    "a horizontal seated leg press gym machine with a weight stack",
    "a hack squat, standing calf raise or belt squat machine",
    "a seated leg curl gym machine with a thigh restraint pad",
    "a seated chest press or shoulder press gym machine",
    "a cable crossover station or adjustable cable tower in a gym",
    "a treadmill, exercise bicycle or rowing cardio ergometer",
    "a bench and dumbbells or a squat rack in a gym",
    "a dual adjustable gym machine or an unreadable close-up of gym equipment",
]
RULES = [
    re.compile(r"\b(?:" + "|".join(re.escape(alias) for alias in item["alias"]) + r")\b")
    for item in MACHINES
]


def unit_vectors(values):
    return values / np.maximum(np.linalg.norm(values, axis=-1, keepdims=True), 1e-12)


def load_onnx(path):
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    return ort.InferenceSession(str(path), sess_options=options, providers=["CPUExecutionProvider"])


def machine_from_label(image):
    if not shutil.which("tesseract"):
        return []
    output = BytesIO()
    image.save(output, "JPEG", quality=92)
    try:
        result = subprocess.run(
            ["tesseract", "stdin", "stdout", "--psm", "11"],
            input=output.getvalue(), capture_output=True, timeout=3, check=True,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    label = re.sub(r"[^a-z0-9]+", " ", result.stdout.decode(errors="ignore").lower().replace("°", " degree "))
    matches = [index for index, rule in enumerate(RULES) if rule.search(label)]
    if len(matches) == 1:
        # Some stations support two movements and name both on the placard.
        other_names = ("leg curl", "hamstring curl", "chest press", "triceps", "shoulder press")
        if any(name in label for name in other_names):
            return [matches[0], None]
    return matches


class MachineScanner:
    def __init__(self):
        self.vision = load_onnx(ROOT / "models" / "vision_model_quantized.onnx")
        self.text_vectors = np.load(ROOT / "models" / "machine-prompts.npy")
        references = np.load(ROOT / "models" / "machine-references.npz")
        self.reference_vectors = references["vectors"]
        self.reference_groups = references["groups"]
        references.close()

    def image_vectors(self, image):
        middle = ImageOps.fit(image, (224, 224), method=Image.Resampling.BICUBIC)
        entire = ImageOps.pad(image, (224, 224), method=Image.Resampling.BICUBIC, color=(128, 128, 128))
        views = (np.array([np.asarray(middle), np.asarray(entire)], dtype=np.float32) / 255 - MEAN) / STD
        embedding = self.vision.run(None, {"pixel_values": views.transpose(0, 3, 1, 2)})[0]
        return unit_vectors(embedding)

    def scores(self, image):
        vectors = self.image_vectors(image)
        text = (vectors @ self.text_vectors.T).mean(axis=0)
        similarity = (vectors @ self.reference_vectors.T).mean(axis=0)
        references = np.array([np.max(similarity[self.reference_groups == i]) for i in range(len(MACHINES))])
        return text, references

    def scan(self, image):
        text, references = self.scores(image)
        # Visual references boost a close match, while unrelated and unsupported
        # equipment descriptions can still veto an uncertain suggestion.
        scores = text[:len(MACHINES)] + np.maximum(0, references - 0.64) * 0.24
        ranks = np.argsort(scores)[::-1]
        first, second = ranks[:2]
        other = np.max(text[len(MACHINES):])
        labels = machine_from_label(image)
        if len(labels) > 1:
            match, reason = None, None
        elif labels:
            match, reason = labels[0], "label"
        elif scores[first] >= 0.22 and scores[first] - max(scores[second], other) >= 0.009:
            match, reason = first, "vision"
        else:
            match, reason = None, None
        return {
            "machine": MACHINES[match]["id"] if match is not None else None,
            "reason": reason,
            "alternatives": [MACHINES[i]["id"] for i in ranks if i != match],
        }


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, scanner, slots, **kwargs):
        self.scanner = scanner
        self.slots = slots
        super().__init__(*args, directory=PUBLIC, **kwargs)

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)

    def send_json(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if urlsplit(self.path).path != "/api/scan":
            self.send_error(HTTPStatus.NOT_FOUND)
            return
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.send_json(HTTPStatus.FORBIDDEN, {"error": "Cross-site photo submission"})
            return
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if not 0 < size <= MAX_UPLOAD:
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Invalid photo size"})
            return
        if self.scanner is None or not self.slots.acquire(blocking=False):
            self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"error": "Scanner unavailable or busy"})
            return
        try:
            with Image.open(BytesIO(self.rfile.read(size))) as original:
                if original.width * original.height > Image.MAX_IMAGE_PIXELS:
                    raise ValueError("Photo dimensions exceed the limit")
                image = ImageOps.exif_transpose(original).convert("RGB")
            image.thumbnail((1440, 1440), Image.Resampling.LANCZOS)
            if min(image.size) < 70:
                raise ValueError("Photo too small")
            result = self.scanner.scan(image)
        except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError):
            self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Could not decode the photo"})
        finally:
            self.slots.release()
        if "result" in locals():
            self.send_json(HTTPStatus.OK, result)


def main():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=38471)
    args = parser.parse_args()
    scanner = None
    try:
        scanner = MachineScanner()
    except Exception as error:
        print(f"Scanner unavailable: {error}", flush=True)
    handler = partial(Handler, scanner=scanner, slots=BoundedSemaphore(1))
    with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
        print(f"My Strength AI is running on http://127.0.0.1:{args.port}/", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
