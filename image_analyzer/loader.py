import logging
import numpy as np
from PIL import Image, UnidentifiedImageError

logger = logging.getLogger(__name__)


def load_image(path: str) -> tuple[np.ndarray, str]:
    try:
        image = Image.open(path)

        if image.mode == "L":
            logger.info("Image is originally grayscale: %s", path)

        fmt = image.format or "UNKNOWN"
        image = image.convert("RGB")
        return np.array(image), fmt

    except (FileNotFoundError, UnidentifiedImageError) as error:
        logger.error("Unable to load image %s: %s", path, error)
        raise