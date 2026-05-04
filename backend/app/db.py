from __future__ import annotations

from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    f"sqlite:///{settings.sqlite_path}",
    connect_args={"check_same_thread": False},
    future=True,
)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False, future=True)


def init_db() -> None:
    # Import models so they register with Base.metadata before create_all.
    from . import models  # noqa: F401

    Base.metadata.create_all(engine)
    _ensure_user_rating_columns(engine)


def _ensure_user_rating_columns(eng) -> None:
    """Add the rating columns to an existing `users` table if they don't exist.

    `Base.metadata.create_all` only creates *new* tables; it never alters
    existing ones. For new installs this is a no-op (the columns are already
    on the create-table). For installs whose `users` table predates the
    rating system, this migrates them in-place. Idempotent — safe to call
    on every startup.
    """
    from .models import RATING_MU0, RATING_SIGMA0
    with eng.begin() as conn:
        cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)")}
        if "rating_mu" not in cols:
            conn.exec_driver_sql(
                f"ALTER TABLE users ADD COLUMN rating_mu REAL NOT NULL DEFAULT {RATING_MU0}"
            )
        if "rating_sigma" not in cols:
            conn.exec_driver_sql(
                f"ALTER TABLE users ADD COLUMN rating_sigma REAL NOT NULL DEFAULT {RATING_SIGMA0}"
            )
        if "games_played" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN games_played INTEGER NOT NULL DEFAULT 0"
            )
        if "rating_updated_at" not in cols:
            conn.exec_driver_sql(
                "ALTER TABLE users ADD COLUMN rating_updated_at DATETIME"
            )


def get_db() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def session_scope() -> Iterator[Session]:
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
