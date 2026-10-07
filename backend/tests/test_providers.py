"""Apple-backed providers, exercised with fake clients (no network, no Apple account)."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select, update

from app.config import Settings
from app.main import create_app
from app.models import ProviderAccount
from app.providers.apple_base import AppleAuthError
from app.providers.findmy.client import RawReport
from app.providers.findmy.provider import _icon_for_name
from app.providers.icloud.client import ICloudSnapshot
from tests.conftest import Api, FakePush


class FakeAppleClient:
    need_2fa = True

    def __init__(self, state=None):
        self.state = state or {}
        self.requested: list[str] = []
        self.reports: dict[str, list[RawReport]] = {}
        self.snapshots: dict[str, ICloudSnapshot] = {}
        self.fail_auth = False
        self.calls: list[tuple] = []

    async def login(self, username, password):
        if password == "bad":
            raise AppleAuthError("invalid Apple ID or password")
        self.state = {"apple_id": username, "password": password}
        return "require_2fa" if self.need_2fa else "logged_in"

    async def get_2fa_methods(self):
        return [{"id": "trusted_device", "type": "trusted_device", "label": "Trusted device"}]

    async def request_2fa(self, method_id):
        self.requested.append(method_id)

    async def submit_2fa(self, method_id, code):
        if code != "123456":
            raise AppleAuthError("invalid code")
        return "logged_in"

    async def fetch(self, items):
        if self.fail_auth:
            raise AppleAuthError("Apple session expired")
        updated = {iid: {"accessory": {"bumped": True}} for iid, s in items if "accessory" in s}
        return {iid: self.reports.get(iid, []) for iid, _ in items}, updated

    async def locate(self):
        if self.fail_auth:
            raise AppleAuthError("Apple session expired")
        return self.snapshots

    async def list_devices(self):
        return list(self.snapshots.values())

    async def play_sound(self, icloud_id):
        self.calls.append(("sound", icloud_id))

    async def lost_mode(self, icloud_id, phone, message):
        self.calls.append(("lost", icloud_id, phone, message))

    def export_state(self):
        return {**self.state, "exported": True}

    async def close(self):
        pass


class FakeToolkit:
    @staticmethod
    def haystack_from_private_key(key):
        if key == "bad":
            raise ValueError("invalid private key")
        return {"private_key_b64": key, "adv_key_b64": "ADV" + key}

    @staticmethod
    def haystack_generate():
        return {"private_key_b64": "PRIV", "adv_key_b64": "ADVNEW"}

    @staticmethod
    def airtag_from_plist(raw, align, name):
        return {"accessory": {"raw": raw.decode()}, "model": "AirTag1,1"}


@pytest.fixture
def apple(tmp_path):
    s = Settings(
        data_dir=tmp_path,
        feature_findmy=True,
        feature_icloud=True,
        rate_limit_enabled=False,
        housekeeping_interval_s=3600,
        _env_file=None,
    )
    app = create_app(s)
    app.state.ctx.push.sender = FakePush()
    fake = FakeAppleClient()
    for kind in ("findmy", "icloud"):
        p = app.state.ctx.providers.get(kind)
        p.new_client = lambda user_id, state, fake=fake: fake
        p.wake = lambda: None
    app.state.ctx.providers.get("findmy").toolkit = FakeToolkit
    with TestClient(app) as c:
        yield c, Api(c), fake, app


def connect(api: Api, user, provider: str):
    c = api.c
    r = c.post(
        f"/api/providers/{provider}/login",
        json={"apple_id": "me@icloud.com", "password": "pw"},
        headers=api.h(user),
    )
    assert r.json()["state"] == "require_2fa"
    r = c.post(
        f"/api/providers/{provider}/2fa/submit",
        json={"method_id": "trusted_device", "code": "123456"},
        headers=api.h(user),
    )
    assert r.json() == {"state": "logged_in"}


def run_poll(client, app, kind):
    client.portal.call(app.state.ctx.providers.get(kind).poll_once)


def test_routes_absent_when_disabled(client, api):
    a = api.register()
    assert client.get("/api/providers/findmy/account", headers=api.h(a)).status_code == 404
    assert client.get("/api/providers/icloud/account", headers=api.h(a)).status_code == 404
    assert (
        client.post("/api/items/generate", json={"name": "x"}, headers=api.h(a)).status_code == 404
    )


def test_login_2fa_and_encrypted_state(apple):
    c, api, fake, app = apple
    a = api.register()
    assert c.get("/api/providers/findmy/account", headers=api.h(a)).json()["state"] == "none"
    bad = c.post(
        "/api/providers/findmy/login",
        json={"apple_id": "me@icloud.com", "password": "bad"},
        headers=api.h(a),
    )
    assert bad.status_code == 401
    connect(api, a, "findmy")
    assert fake.requested == ["trusted_device"]  # first code requested automatically
    acc = c.get("/api/providers/findmy/account", headers=api.h(a)).json()
    assert acc["state"] == "logged_in" and acc["display"] == "m***@icloud.com"

    async def stored():
        async with app.state.ctx.sessionmaker() as db:
            row = (await db.execute(select(ProviderAccount))).scalar_one()
            return row.secret_blob

    blob = c.portal.call(stored)
    # Look for plaintext JSON: two bare bytes like b"pw" turn up in random ciphertext now and then.
    assert b'"password"' not in blob and b"me@icloud.com" not in blob
    assert app.state.ctx.box.decrypt_json(blob)["password"] == "pw"
    assert c.delete("/api/providers/findmy/account", headers=api.h(a)).status_code == 204
    assert c.get("/api/providers/findmy/account", headers=api.h(a)).json()["state"] == "none"


def test_wrong_2fa_code(apple):
    c, api, _, _ = apple
    a = api.register()
    c.post(
        "/api/providers/icloud/login",
        json={"apple_id": "x@icloud.com", "password": "pw"},
        headers=api.h(a),
    )
    r = c.post("/api/providers/icloud/2fa/submit", json={"code": "000000"}, headers=api.h(a))
    assert r.status_code == 401
    r = c.post("/api/providers/findmy/2fa/submit", json={"code": "123456"}, headers=api.h(a))
    assert r.status_code == 409  # nothing pending for that provider


def test_findmy_items_and_poll(apple):
    c, api, fake, app = apple
    a = api.register()
    connect(api, a, "findmy")
    r = c.post("/api/items/generate", json={"name": "Keys"}, headers=api.h(a))
    assert r.status_code == 201
    assert r.json()["adv_key_b64"] == "ADVNEW"
    assert "PRIV" not in r.text
    tag = r.json()["device"]
    r = c.post(
        "/api/items",
        data={"name": "Bag", "type": "airtag"},
        files={"plist": ("a.plist", b"<plist/>", "application/xml")},
        headers=api.h(a),
    )
    assert r.status_code == 201, r.text
    airtag = r.json()
    assert airtag["provider_info"]["model"] == "AirTag1,1"
    r = c.post(
        "/api/items",
        data={"name": "X", "type": "haystack", "private_key_b64": "bad"},
        headers=api.h(a),
    )
    assert r.status_code == 400

    now = datetime.now(UTC)
    fake.reports = {
        tag["id"]: [RawReport(now - timedelta(minutes=40), 48.85, 2.35, 30, 0)],
        airtag["id"]: [
            RawReport(now - timedelta(minutes=50), 48.80, 2.30, 50, 0b10 << 6),
            RawReport(now - timedelta(minutes=20), 48.81, 2.31, 40, 0b10 << 6),
        ],
    }
    run_poll(c, app, "findmy")
    devs = {d["id"]: d for d in c.get("/api/devices", headers=api.h(a)).json()}
    assert devs[tag["id"]]["location"]["lat"] == 48.85
    assert devs[tag["id"]]["battery"] is None  # DIY tags: status byte is not battery
    assert devs[airtag["id"]]["location"]["lat"] == 48.81
    assert devs[airtag["id"]]["battery"]["label"] == "low"
    assert "refresh" in devs[tag["id"]]["capabilities"]
    # re-polling the same reports does not duplicate history
    run_poll(c, app, "findmy")
    hist = c.get(
        f"/api/devices/{airtag['id']}/locations",
        params={"from": (now - timedelta(hours=2)).isoformat()},
        headers=api.h(a),
    ).json()
    assert hist["total"] == 2
    r = c.post(f"/api/devices/{tag['id']}/refresh", headers=api.h(a))
    assert r.status_code == 202


@pytest.mark.parametrize(
    ("name", "icon"),
    [
        ("Clés de Marco", "key"),
        ("Keys", "key"),
        ("Voiture", "car"),
        ("Sac à dos", "backpack"),
        ("Portefeuille", "wallet"),
        ("Vélo", "bike"),
        ("Valise rouge", "suitcase"),
        ("Chien", "pet"),
        ("Carte bleue", "tag"),  # "car" only as a whole word
        ("Tag 3", "tag"),
    ],
)
def test_item_icon_from_name(name, icon):
    assert _icon_for_name(name) == icon


def test_findmy_item_icon(apple):
    c, api, _, _ = apple
    a = api.register()
    connect(api, a, "findmy")
    keys = c.post("/api/items/generate", json={"name": "Clés de Marco"}, headers=api.h(a))
    assert keys.json()["device"]["icon"] == "key"
    car = c.post(
        "/api/items",
        data={"name": "Voiture", "type": "haystack", "private_key_b64": "K"},
        headers=api.h(a),
    ).json()
    assert car["icon"] == "car"
    r = c.patch(f"/api/devices/{car['id']}", json={"icon": "pet"}, headers=api.h(a))
    assert r.status_code == 200 and r.json()["icon"] == "pet"
    assert c.get(f"/api/devices/{car['id']}", headers=api.h(a)).json()["icon"] == "pet"
    r = c.patch(f"/api/devices/{car['id']}", json={"icon": "spaceship"}, headers=api.h(a))
    assert r.status_code == 422


def test_poll_auth_failure_requires_reauth(apple):
    c, api, fake, app = apple
    a = api.register()
    connect(api, a, "findmy")
    c.post("/api/items/generate", json={"name": "Keys"}, headers=api.h(a))
    fake.fail_auth = True
    run_poll(c, app, "findmy")
    assert c.get("/api/providers/findmy/account", headers=api.h(a)).json()["state"] == (
        "reauth_required"
    )
    notes = c.get("/api/notifications", headers=api.h(a)).json()
    assert notes[0]["kind"] == "provider_error"


def test_icloud_track_poll_and_commands(apple):
    c, api, fake, app = apple
    a = api.register()
    connect(api, a, "icloud")
    ts = datetime.now(UTC) - timedelta(minutes=1)
    fake.snapshots = {
        "abc": ICloudSnapshot("abc", "Alice's iPhone", "iPhone 16", 48.85, 2.29, 12, ts, 0.8, True),
        "def": ICloudSnapshot("def", "MacBook", "MacBook Pro", None, None, None, None, None, None),
    }
    listed = c.get("/api/providers/icloud/devices", headers=api.h(a)).json()
    assert {d["icloud_device_id"] for d in listed} == {"abc", "def"}
    r = c.post("/api/providers/icloud/devices", json={"icloud_device_id": "abc"}, headers=api.h(a))
    assert r.status_code == 201
    dev = r.json()
    assert dev["kind"] == "icloud" and dev["icon"] == "phone"
    assert set(dev["capabilities"]) >= {"play_sound", "lost_mode", "refresh"}
    listed = c.get("/api/providers/icloud/devices", headers=api.h(a)).json()
    assert (
        next(d for d in listed if d["icloud_device_id"] == "abc")["tracked_device_id"] == dev["id"]
    )

    run_poll(c, app, "icloud")
    got = c.get(f"/api/devices/{dev['id']}", headers=api.h(a)).json()
    assert got["location"]["lat"] == 48.85
    assert got["battery"]["level"] == 0.8

    r = c.post(f"/api/devices/{dev['id']}/commands", json={"type": "play_sound"}, headers=api.h(a))
    assert r.json()["status"] == "acked" and r.json()["channel"] == "api"
    r = c.post(
        f"/api/devices/{dev['id']}/commands",
        json={"type": "lost_mode_on", "message": "Call me", "phone": "+331"},
        headers=api.h(a),
    )
    assert r.json()["status"] == "acked"
    assert fake.calls == [("sound", "abc"), ("lost", "abc", "+331", "Call me")]
    got = c.get(f"/api/devices/{dev['id']}", headers=api.h(a)).json()
    assert got["lost_mode"]["enabled"] is True
    r = c.post(
        f"/api/devices/{dev['id']}/commands", json={"type": "lost_mode_off"}, headers=api.h(a)
    )
    assert r.json()["status"] == "acked"


def test_browser_attached_to_icloud_device(apple):
    c, api, fake, app = apple
    a = api.register()
    connect(api, a, "icloud")
    fake.snapshots = {
        "def": ICloudSnapshot("def", "MacBook", "MacBook Pro", None, None, None, None, None, None)
    }
    mac = c.post(
        "/api/providers/icloud/devices", json={"icloud_device_id": "def"}, headers=api.h(a)
    )
    mac_id = mac.json()["id"]
    # This browser runs on that Mac: it reports to the Mac's entry, no copy is created.
    r = c.post(f"/api/devices/{mac_id}/browser", headers=api.h(a))
    assert r.status_code == 200 and r.json()["device"]["id"] == mac_id
    browser = {"id": mac_id, "token": r.json()["device_token"]}
    assert api.report(browser, 48.2, 16.4).status_code == 202
    got = c.get(f"/api/devices/{mac_id}", headers=api.h(a)).json()
    assert got["location"]["lat"] == 48.2
    assert [d["id"] for d in c.get("/api/devices", headers=api.h(a)).json()] == [mac_id]
    # Forgetting the browser keeps the Mac.
    assert c.delete(f"/api/devices/{mac_id}/browser", headers=api.h(a)).status_code == 204
    assert api.report(browser, 48.2, 16.4).status_code == 401
    assert c.get(f"/api/devices/{mac_id}", headers=api.h(a)).status_code == 200
    # Only iCloud devices take a browser.
    other = api.device(a, "Laptop")
    assert c.post(f"/api/devices/{other['id']}/browser", headers=api.h(a)).status_code == 400


def test_icloud_poll_tracks_every_device(apple):
    c, api, fake, app = apple
    a = api.register()
    connect(api, a, "icloud")
    ts = datetime.now(UTC) - timedelta(minutes=1)
    fake.snapshots = {
        "def": ICloudSnapshot("def", "AirPods", "AirPods Pro", None, None, None, None, None, None),
        "abc": ICloudSnapshot("abc", "iPhone", "iPhone 16", 48.85, 2.29, 12, ts, 0.8, True),
    }
    run_poll(c, app, "icloud")
    devices = {d["name"]: d for d in c.get("/api/devices", headers=api.h(a)).json()}
    assert set(devices) == {"iPhone", "AirPods"}
    assert devices["iPhone"]["location"]["lat"] == 48.85
    assert devices["AirPods"]["icon"] == "earbuds" and devices["AirPods"]["location"] is None
    assert devices["iPhone"]["is_primary"] and not devices["AirPods"]["is_primary"]

    async def due_now():
        async with app.state.ctx.sessionmaker() as db:
            await db.execute(update(ProviderAccount).values(next_poll_at=None))
            await db.commit()

    c.portal.call(due_now)
    run_poll(c, app, "icloud")
    assert len(c.get("/api/devices", headers=api.h(a)).json()) == 2


def test_icloud_command_failure_restores_state(apple):
    c, api, fake, app = apple
    a = api.register()
    connect(api, a, "icloud")
    fake.snapshots = {
        "abc": ICloudSnapshot("abc", "iPhone", "iPhone", 1, 1, 5, datetime.now(UTC), None, None)
    }
    dev = c.post(
        "/api/providers/icloud/devices", json={"icloud_device_id": "abc"}, headers=api.h(a)
    ).json()

    async def boom(*_):
        raise RuntimeError("503 from Apple")

    fake.lost_mode = boom
    r = c.post(
        f"/api/devices/{dev['id']}/commands",
        json={"type": "lost_mode_on", "message": "x"},
        headers=api.h(a),
    )
    assert r.json()["status"] == "failed"
    assert "503" in r.json()["error"]
    got = c.get(f"/api/devices/{dev['id']}", headers=api.h(a)).json()
    assert got["lost_mode"]["enabled"] is False


def test_real_findmy_keys_if_installed():
    pytest.importorskip("findmy")
    from app.providers.findmy import client as fm

    gen = fm.haystack_generate()
    again = fm.haystack_from_private_key(gen["private_key_b64"])
    assert again["adv_key_b64"] == gen["adv_key_b64"]
    with pytest.raises(ValueError):
        fm.haystack_from_private_key("not a key")
    assert fm.battery_from_status(0b11 << 6) == ("very_low", 0.1)
