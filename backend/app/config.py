from __future__ import annotations

import os
import secrets
from functools import cached_property
from pathlib import Path
from urllib.parse import urlparse

from pydantic_settings import BaseSettings, SettingsConfigDict

# OpenFreeMap vector styles (no key, no account), drawn with MapLibre. A raster tile URL
# with {z}/{x}/{y} works too.
DEFAULT_TILE_URL = "https://tiles.openfreemap.org/styles/liberty"
DEFAULT_TILE_URL_DARK = "https://tiles.openfreemap.org/styles/dark"
DEFAULT_TILE_ATTRIBUTION = (
    '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> '
    "&copy; OpenMapTiles &copy; OpenStreetMap contributors"
)


class Settings(BaseSettings):
    """Runtime configuration, read from environment variables (and an optional .env file)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    data_dir: Path = Path("./data")
    database_url: str | None = None
    secret_key: str | None = None
    # Public URL of the instance (e.g. https://find.example.com). Used for the Origin check
    # and to decide whether cookies are marked Secure.
    base_url: str | None = None
    static_dir: Path | None = None

    allow_registration: bool = True
    trust_proxy: bool = False
    rate_limit_enabled: bool = True
    session_days: int = 30

    tile_url: str = DEFAULT_TILE_URL
    # Dark-mode map. Unset: OpenFreeMap dark with the default map, else the same as tile_url.
    tile_url_dark: str | None = None
    tile_attribution: str = DEFAULT_TILE_ATTRIBUTION

    feature_owntracks: bool = True
    feature_findmy: bool = False
    feature_icloud: bool = False

    findmy_poll_interval_s: int = 300
    icloud_poll_interval_s: int = 120
    icloud_auto_track: bool = True
    anisette_url: str | None = None

    zone_confirm_fixes: int = 2
    zone_max_accuracy_m: float = 250.0
    location_retention_days: int = 30
    housekeeping_interval_s: int = 60

    vapid_subject: str = "mailto:admin@localhost"

    @cached_property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite+aiosqlite:///{(self.data_dir / 'locus.db').resolve()}"

    @property
    def resolved_tile_url_dark(self) -> str:
        if self.tile_url_dark:
            return self.tile_url_dark
        return DEFAULT_TILE_URL_DARK if self.tile_url == DEFAULT_TILE_URL else self.tile_url

    @property
    def cookie_secure(self) -> bool:
        return bool(self.base_url and self.base_url.startswith("https://"))

    @property
    def base_origin(self) -> str | None:
        if not self.base_url:
            return None
        u = urlparse(self.base_url)
        return f"{u.scheme}://{u.netloc}"


def _read_or_create(path: Path, factory) -> str:
    if path.exists():
        return path.read_text().strip()
    value = factory()
    path.write_text(value)
    os.chmod(path, 0o600)
    return value


def bootstrap(settings: Settings) -> Settings:
    """Create the data directory and generate persistent secrets on first start."""
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    if not settings.secret_key:
        settings.secret_key = _read_or_create(
            settings.data_dir / "secret_key", lambda: secrets.token_urlsafe(48)
        )
    return settings
