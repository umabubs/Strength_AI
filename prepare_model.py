"""Download the pinned CLIP model and build the prototype's prompt vectors."""
from pathlib import Path
import shutil
from urllib.request import urlopen

import numpy as np
from tokenizers import Tokenizer

from server import MACHINES, ROOT, UNKNOWN, load_onnx, unit_vectors

REVISION = "6b7c523703ae26e39be4b03774966f8571c7f523"
BUCKET = f"https://huggingface.co/Xenova/clip-vit-base-patch32/resolve/{REVISION}"
MODELS = ROOT / "models"


def get(relpath):
    target = MODELS / Path(relpath).name
    if not target.exists():
        with urlopen(f"{BUCKET}/{relpath}", timeout=120) as response:
            temporary = target.with_suffix(".part")
            with temporary.open("wb") as destination:
                shutil.copyfileobj(response, destination)
        temporary.replace(target)
    return target


if __name__ == "__main__":
    MODELS.mkdir(exist_ok=True)
    get("onnx/vision_model_quantized.onnx")
    if not (MODELS / "machine-prompts.npy").exists():
        tokenizer = Tokenizer.from_file(str(get("tokenizer.json")))
        tokenizer.enable_padding(pad_id=49407, pad_token="<|endoftext|>", length=77)
        tokenizer.enable_truncation(max_length=77)
        descriptions = [m["visual"] for m in MACHINES] + UNKNOWN
        prompts = [f"A clear photograph of {description}." for description in descriptions]
        tokens = np.array([encoded.ids for encoded in tokenizer.encode_batch(prompts)], dtype=np.int64)
        model = load_onnx(get("onnx/text_model_quantized.onnx"))
        embeddings = model.run(None, {"input_ids": tokens})[0]
        np.save(MODELS / "machine-prompts.npy", unit_vectors(embeddings))
