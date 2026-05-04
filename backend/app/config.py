from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="TILEGAME_", env_file=".env", extra="ignore")

    jwt_secret: str = "dev-secret-change-me"
    jwt_alg: str = "HS256"
    jwt_ttl_hours: int = 24 * 30  # 30 days

    sqlite_path: Path = Path(__file__).resolve().parent.parent / "tilegame.db"
    data_dir: Path = Path(__file__).resolve().parent / "data"

    default_pool_size: int = 150  # informational; actual size driven by tile_distribution.json
    default_turn_seconds: int = 180  # 3 min per turn (matches handwritten rules)
    practice_turn_seconds: int = 180


settings = Settings()
