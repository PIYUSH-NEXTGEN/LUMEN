from .connection import engine
from .models import Base


Base.metadata.create_all(engine)

print("Tables created successfully!")