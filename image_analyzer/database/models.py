from datetime import datetime

from sqlalchemy.orm import  DeclarativeBase,Mapped, mapped_column
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import String, DateTime

class Base(DeclarativeBase):
    pass


class Image(Base):
    __tablename__ = "images"

    id: Mapped[ int] = mapped_column(primary_key=True)
    filename: Mapped[ str] = mapped_column(String(255))
    file_path: Mapped[ str] = mapped_column(String(255))
    file_hash: Mapped[ str] = mapped_column(String(255))
    analyzed_at: Mapped[ str] = mapped_column(String(255))

    width: Mapped[int]
    height: Mapped[int]
    img_dtype: Mapped[str]
    mean: Mapped[float]
    std: Mapped[float]
    minimum: Mapped[int]
    maximum: Mapped[int]

    mean_brightness: Mapped[float]
    luminance_brightness: Mapped[float]
    contrast_score: Mapped[float]
    sharpness_score: Mapped[float]
    colorfulness_score: Mapped[float]
    underexposed_pct: Mapped[float]
    overexposed_pct: Mapped[float]
    entropy_score: Mapped[float]

    channel_stats: Mapped[dict] = mapped_column(JSONB)
    histogram_regions: Mapped[dict] = mapped_column(JSONB)
    dominant_colors: Mapped[list] = mapped_column(JSONB)

class DuplicateGroup(Base):
    __tablename__ = "duplicate_groups"

    id: Mapped[int] = mapped_column(primary_key=True)

    hash: Mapped[str] = mapped_column(
        String(64),
        unique=True
    )

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))










