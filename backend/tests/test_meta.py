import json
from pathlib import Path

from fastapi.testclient import TestClient

from app import version
from app.config import Settings
from app.main import create_app

REPO = Path(__file__).resolve().parents[2]


def test_one_version_for_backend_and_frontend():
    package = json.loads((REPO / "frontend" / "package.json").read_text())
    assert package["version"] == version.VERSION, (
        "backend/pyproject.toml and frontend/package.json must carry the same version"
    )


def test_revision_file(tmp_path):
    assert version.read_revision(tmp_path) == "dev"
    (tmp_path / "REVISION").write_text("6aace8e\n")
    assert version.read_revision(tmp_path) == "6aace8e"
    (tmp_path / "REVISION").write_text("<b>oops</b>")
    assert version.read_revision(tmp_path) == "dev"
    assert version.read_version(tmp_path) == "0.0.0"


def test_config_announces_version_and_revision(client, monkeypatch):
    cfg = client.get("/api/config").json()
    assert cfg["version"] == version.VERSION
    assert cfg["retention_days"] == 30
    monkeypatch.setattr(version, "REVISION", "6aace8e")
    assert client.get("/api/config").json()["revision"] == "6aace8e"


def test_robots_txt_and_header(client):
    r = client.get("/robots.txt")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/plain")
    assert r.text.splitlines() == ["User-agent: *", "Disallow: /"]
    assert r.headers["x-robots-tag"] == "noindex, nofollow"
    assert client.get("/api/health").headers["x-robots-tag"] == "noindex, nofollow"


INDEX = """<!doctype html>
<html lang="en">
  <head>
    <meta property="og:image" content="/icons/icon-512.png" />
  </head>
</html>
"""


def _static(tmp_path) -> Path:
    static = tmp_path / "static"
    (static / "icons").mkdir(parents=True)
    (static / "index.html").write_text(INDEX)
    (static / "icons" / "icon-512.png").write_bytes(b"png")
    return static


def test_index_in_the_server_language_with_absolute_preview_urls(tmp_path):
    settings = Settings(
        data_dir=tmp_path / "data",
        static_dir=_static(tmp_path),
        default_locale="fr",
        base_url="https://find.example.com/",
        _env_file=None,
    )
    with TestClient(create_app(settings)) as c:
        for path in ("/", "/index.html", "/privacy"):
            r = c.get(path)
            assert r.status_code == 200
            assert '<html lang="fr">' in r.text
            assert 'content="https://find.example.com/icons/icon-512.png"' in r.text
            assert r.headers["cache-control"] == "no-cache"
            assert r.headers["x-robots-tag"] == "noindex, nofollow"
        assert c.get("/icons/icon-512.png").content == b"png"
        assert c.get("/robots.txt").text.startswith("User-agent: *")


def test_index_unchanged_without_default_locale_or_base_url(tmp_path):
    settings = Settings(data_dir=tmp_path / "data", static_dir=_static(tmp_path), _env_file=None)
    with TestClient(create_app(settings)) as c:
        assert c.get("/").text == INDEX
