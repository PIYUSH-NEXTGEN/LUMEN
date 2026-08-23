import os

from image_analyzer.models import ImageReport
from image_analyzer.database.models import Image
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL

load_dotenv()

DATABASE_URL = URL.create(
    drivername="postgresql+psycopg2",
    username=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
    host=os.getenv("DB_HOST"),
    port=int(os.getenv("DB_PORT", 5432)),
    database=os.getenv("DB_NAME"),
)

engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
)

def save_to_db(report: ImageReport):
    session = SessionLocal()

    try:
        image = Image(
            filename=report.filename,
            file_path=report.file_path,
            file_hash=report.file_hash,

            width=report.image_stats.shape[1],
            height=report.image_stats.shape[0],
            img_dtype=report.image_stats.dtype,
            mean=report.image_stats.mean,
            std=report.image_stats.std,
            minimum=report.image_stats.minimum,
            maximum=report.image_stats.maximum,

            mean_brightness=report.mean_brightness,
            luminance_brightness=report.luminance_brightness,
            contrast_score=report.contrast_score,
            sharpness_score=report.sharpness_score,
            colorfulness_score=report.colorfulness_score,
            underexposed_pct=report.underexposed_pct,
            overexposed_pct=report.overexposed_pct,
            entropy_score=report.entropy_score,

            channel_stats=report.channel_stats.model_dump(),
            histogram_regions=report.histogram.model_dump(),
            dominant_colors=[
                color.model_dump()
                for color in report.dominant_colors
            ],
        )

        session.add(image)
        session.commit()
        session.refresh(image)

        return image

    except Exception:
        session.rollback()
        raise

    finally:
        session.close()