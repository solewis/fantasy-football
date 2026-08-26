import os
from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# Normally the one local SQLite file. The override exists so migrations can be
# exercised against a throwaway database -- both the round-trip test and CI's
# `alembic check` need a schema they can build from scratch and discard, and
# pointing those at the real app.db would be the one way to actually lose data.
DATABASE_URL = os.getenv("FANTASY_DB_URL") or f"sqlite:///{DATA_DIR / 'app.db'}"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


class Base(DeclarativeBase):
    pass


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def as_utc(value: datetime | None) -> datetime | None:
    """Reattach UTC tzinfo to a naive datetime read back from the DB.

    SQLite has no timezone-aware column type, so a value stored as tz-aware UTC
    comes back naive. Everything this app writes is UTC by construction
    (`datetime.now(UTC)`), so reattaching is always correct -- and necessary,
    since an offset-less timestamp is silently parsed as *local* time by JS's
    Date, which shows a just-created row as hours in the future.
    """
    if value is None or value.tzinfo is not None:
        return value
    return value.replace(tzinfo=UTC)
