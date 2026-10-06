from __future__ import annotations

import itertools
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

_counter = itertools.count()


class FakePush:
    """Records pushes instead of sending them; can simulate a dead subscription."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, dict[str, Any]]] = []
        self.status = 201

    async def __call__(self, sub, payload) -> int:
        self.sent.append((sub.endpoint, payload))
        return self.status


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        data_dir=tmp_path,
        static_dir=None,
        base_url=None,
        rate_limit_enabled=False,
        housekeeping_interval_s=3600,
        _env_file=None,
    )


@pytest.fixture
def fake_push() -> FakePush:
    return FakePush()


@pytest.fixture
def app(settings, fake_push):
    app = create_app(settings)
    app.state.ctx.push.sender = fake_push
    return app


@pytest.fixture
def client(app):
    with TestClient(app) as c:
        yield c


class Api:
    """Small helper wrapping a TestClient with per-user bearer tokens."""

    def __init__(self, client: TestClient):
        self.c = client

    def register(self, name: str = "Alice", locale: str = "en") -> dict:
        email = f"{name.lower()}{next(_counter)}@example.com"
        r = self.c.post(
            "/api/auth/register?bearer=1",
            json={
                "email": email,
                "password": "correct horse",
                "display_name": name,
                "locale": locale,
            },
        )
        assert r.status_code == 201, r.text
        self.c.cookies.clear()
        body = r.json()
        return {"id": body["user"]["id"], "email": email, "token": body["token"], "name": name}

    @staticmethod
    def h(user: dict) -> dict:
        return {"Authorization": f"Bearer {user['token']}"}

    def device(self, user: dict, name: str = "Phone", kind: str = "browser") -> dict:
        r = self.c.post("/api/devices", json={"name": name, "kind": kind}, headers=self.h(user))
        assert r.status_code == 201, r.text
        body = r.json()
        return {"id": body["device"]["id"], "token": body["device_token"]}

    def report(self, device: dict, lat: float, lon: float, acc: float = 10, ts=None, battery=None):
        ts = ts or datetime.now(UTC)
        body: dict = {"fixes": [{"ts": ts.isoformat(), "lat": lat, "lon": lon, "accuracy": acc}]}
        if battery is not None:
            body["battery"] = {"level": battery, "charging": False}
        return self.c.post(
            "/api/report/locations",
            json=body,
            headers={"Authorization": f"Bearer {device['token']}"},
        )

    def share(self, owner: dict, recipient: dict, accept: bool = True, expires_at=None) -> str:
        r = self.c.post(
            "/api/shares",
            json={"recipient_email": recipient["email"], "expires_at": expires_at},
            headers=self.h(owner),
        )
        assert r.status_code == 201, r.text
        sid = r.json()["id"]
        if accept:
            r = self.c.post(f"/api/shares/{sid}/accept", headers=self.h(recipient))
            assert r.status_code == 200, r.text
        return sid


@pytest.fixture
def api(client) -> Api:
    return Api(client)


def ago(**kw) -> datetime:
    return datetime.now(UTC) - timedelta(**kw)
