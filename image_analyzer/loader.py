from pathlib import Path
import numpy as np
from PIL import Image

def load_image(path: str) -> np.ndarray:
    image = Image.open(path)

    if image.mode == "L":
        print("Image is originally grayscale")

    image = image.convert("RGB")

    return np.array(image)