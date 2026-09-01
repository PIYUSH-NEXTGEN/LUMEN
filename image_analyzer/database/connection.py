import os

from sqlalchemy import update, select
from image_analyzer.models import ImageReport
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.engine import URL
from image_analyzer.models import DuplicateGroup as ReportDuplicateGroup
from image_analyzer.database.models import DuplicateGroup  as DuplicateGroupDB, Image


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

def check_db_connection() -> None:
    with engine.connect():
        pass

def save_to_db(report: ImageReport):
    session = SessionLocal()

    try:
        image = session.scalar(
            select(Image).where(Image.file_path == report.file_path)
        )

        if image is None:
            image = Image(file_path=report.file_path)
            session.add(image)

        image.filename = report.filename
        image.file_hash = report.file_hash

        image.width = report.image_stats.shape[1]
        image.height = report.image_stats.shape[0]
        image.img_dtype = report.image_stats.dtype
        image.mean = report.image_stats.mean
        image.std = report.image_stats.std
        image.minimum = report.image_stats.minimum
        image.maximum = report.image_stats.maximum

        image.mean_brightness = report.mean_brightness
        image.luminance_brightness = report.luminance_brightness
        image.contrast_score = report.contrast_score
        image.sharpness_score = report.sharpness_score
        image.colorfulness_score = report.colorfulness_score
        image.underexposed_pct = report.underexposed_pct
        image.overexposed_pct = report.overexposed_pct
        image.entropy_score = report.entropy_score

        image.aspect_ratio = report.aspect_ratio
        image.megapixels = report.megapixels
        image.file_size_kb = report.file_size_kb
        image.format = report.format

        image.channel_stats = report.channel_stats.model_dump()
        image.histogram_regions = report.histogram.model_dump()
        image.dominant_colors = [
            color.model_dump() for color in report.dominant_colors
        ]

        session.commit()
        session.refresh(image)

        return image

    except Exception:
        session.rollback()
        raise

    finally:
        session.close()

def save_duplicate_group(group: ReportDuplicateGroup) -> None:
    with SessionLocal() as session:
        db_group = session.scalar(
            select(DuplicateGroupDB)
            .where(DuplicateGroupDB.hash == group.hash)
        )

        if db_group is None:
            db_group = DuplicateGroupDB(hash=group.hash)
            session.add(db_group)
            session.flush()

        session.execute(
            update(Image)
            .where(Image.file_hash == group.hash)
            .values(duplicate_group_id=db_group.id)
        )

        session.commit()