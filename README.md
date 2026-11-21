# My Strength AI

A separate experimental machine scanner and exercise guide. Its bundled tracker is a copy of My Strength v3.3.4 with isolated browser storage. Use the experimental tracker only for test workouts. The live GitHub tracker needs an explicit integration before this prototype can add to it.

## Run locally

Use Python 3.12 or later with a virtual environment. The first setup downloads the pinned CLIP vision model, about 89 MB. The prompt and reference vectors are bundled.

```sh
python -m pip install -r requirements.txt
python prepare_model.py
python server.py
```

Open http://127.0.0.1:38471/ on the computer running the server. Camera capture on a phone requires serving the prototype over HTTPS on a separate origin. Tesseract is optional and can read machine placards if installed. The visual scanner works without it.

## Try the three functions

1. **Scan machine.** Take a photo, choose an existing image, or try the built-in exercise illustration. The scanner compares the image against four supported machine categories and can decline to suggest a match. Confirm the suggestion or choose another machine.
2. **Learn machine.** Read the setup, technique and target muscles from the fixed, source-linked catalogue. Lat pulldown and 45° leg press have animations. Seated cable row and leg extension have illustrated demonstrations.
3. **Add to workout.** The confirmed exercise opens in the experimental tracker with empty set entries. If a draft already exists, the exercise is added to it. Tapping Add again does not create a duplicate.

## Data and model

The browser resizes the selected photo and strips EXIF data when it produces the scan image. The Python server processes the scan in memory and does not save the photo or send it to an external AI service. The experimental workout state stays in the browser. The server listens on loopback by default.

The scanner uses [Xenova’s CLIP model conversion](https://huggingface.co/Xenova/clip-vit-base-patch32). Reference vectors include existing My Strength artwork and representative product images from [Life Fitness](https://www.lifefitness.com/en-us/brands/hammer-strength). The sample shipped in the interface is from the original My Strength exercise guide. Recognition is experimental and performance has not been validated across gyms or machine brands.
