from sqlalchemy import text

from .connection import engine
from .models import Base

NEW_COLUMNS = [
    ("aspect_ratio", "DOUBLE PRECISION"),
    ("megapixels", "DOUBLE PRECISION"),
    ("file_size_kb", "DOUBLE PRECISION"),
    ("format", "VARCHAR(20)"),
]

Base.metadata.create_all(engine)

with engine.begin() as connection:
    for column_name, column_type in NEW_COLUMNS:
        connection.execute(
            text(
                f"ALTER TABLE images ADD COLUMN IF NOT EXISTS "
                f"{column_name} {column_type}"
            )
        )

print("Tables created successfully!")