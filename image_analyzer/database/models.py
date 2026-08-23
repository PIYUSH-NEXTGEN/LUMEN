from sqlalchemy.orm import  DeclarativeBase,Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy import String, DateTime, ForeignKey, func


class Base(DeclarativeBase):
    pass


class Image(Base):
    __tablename__ = "images"

    id: Mapped[ int] = mapped_column(primary_key=True)
    filename: Mapped[ str] = mapped_column(String(255), nullable=False)

    duplicate_group_id: Mapped[int | None] = mapped_column(
        ForeignKey("duplicate_groups.id",ondelete="SET NULL"),
        nullable=True )

    duplicate_group: Mapped["DuplicateGroup | None"] = relationship(
        back_populates="images"
    )

    file_path: Mapped[ str] = mapped_column(String(1000), nullable=False, index=True)
    file_hash: Mapped[ str] = mapped_column(String(64),  nullable=False, index=True)
    analyzed_at: Mapped[ DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    width: Mapped[int] = mapped_column(nullable=True)
    height: Mapped[int] = mapped_column(nullable=True)
    img_dtype: Mapped[str | None] = mapped_column(String(50), nullable=True)
    mean: Mapped[float | None] = mapped_column(nullable=True)
    std: Mapped[float | None] = mapped_column(nullable=True)
    minimum: Mapped[int | None] = mapped_column(nullable=True)
    maximum: Mapped[int | None] = mapped_column(nullable=True)

    mean_brightness: Mapped[float | None] = mapped_column(nullable=True)
    luminance_brightness: Mapped[float | None] = mapped_column(nullable=True)
    contrast_score: Mapped[float | None] = mapped_column(nullable=True)
    sharpness_score: Mapped[float | None] = mapped_column(nullable=True)
    colorfulness_score: Mapped[float | None] = mapped_column(nullable=True)
    underexposed_pct: Mapped[float | None] = mapped_column(nullable=True)
    overexposed_pct: Mapped[float | None] = mapped_column(nullable=True)
    entropy_score: Mapped[float | None] = mapped_column(nullable=True)

    channel_stats: Mapped[dict] = mapped_column(JSONB,nullable=True)
    histogram_regions: Mapped[dict] = mapped_column(JSONB,nullable=True)
    dominant_colors: Mapped[list] = mapped_column(JSONB,nullable=True)

class DuplicateGroup(Base):
    __tablename__ = "duplicate_groups"

    id: Mapped[int] = mapped_column(primary_key=True)
    hash: Mapped[str] = mapped_column(String(64), unique=True )
    created_at: Mapped[DateTime] = mapped_column(DateTime(timezone=True), server_default=func.now(),nullable=False)

    images: Mapped[list["Image"]] = relationship(back_populates="duplicate_group",passive_deletes=True)









