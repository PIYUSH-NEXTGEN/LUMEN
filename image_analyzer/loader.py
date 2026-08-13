import logging
import numpy as np
from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)

def load_image(path: str) -> np.ndarray:
    try:
        image = Image.open(path)

        if image.mode == "L":
            logger.info("Image is originally grayscale: %s", path)

        image = image.convert("RGB")
        return np.array(image)

    except (FileNotFoundError, UnidentifiedImageError) as error:
        logger.error("Unable to load image %s: %s", path, error)
        raise