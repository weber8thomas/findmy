import json
from pathlib import Path

from app import version

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
