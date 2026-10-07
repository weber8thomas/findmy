"""The running version (pyproject.toml) and the git revision it was built from."""

from __future__ import annotations

import re
import tomllib
from pathlib import Path

# backend/ in a checkout, /app in the image: pyproject.toml is next to app/ in both.
ROOT = Path(__file__).resolve().parent.parent


def read_version(root: Path = ROOT) -> str:
    try:
        with (root / "pyproject.toml").open("rb") as f:
            return str(tomllib.load(f)["project"]["version"])
    except (OSError, KeyError, tomllib.TOMLDecodeError):
        return "0.0.0"


def read_revision(root: Path = ROOT) -> str:
    """Short commit hash written to REVISION by deploy.sh (copied into the image); "dev" without."""
    try:
        rev = (root / "REVISION").read_text().strip()
    except OSError:
        return "dev"
    return rev if re.fullmatch(r"[0-9a-f]{4,40}", rev) else "dev"


VERSION = read_version()
REVISION = read_revision()
