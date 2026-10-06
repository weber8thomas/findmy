import base64
import time

import pytest

from app.crypto import InvalidToken, SecretBox


def basic(email: str, token: str) -> dict:
    return {"Authorization": "Basic " + base64.b64encode(f"{email}:{token}".encode()).decode()}


def test_owntracks_ingest(api, client):
    a = api.register("A")
    d = api.device(a, "OT", kind="owntracks")
    msg = {
        "_type": "location",
        "lat": 48.1,
        "lon": 2.2,
        "tst": int(time.time()),
        "acc": 12,
        "vel": 36,
        "batt": 80,
        "bs": 2,
        "tid": "AB",
    }
    r = client.post("/api/owntracks", json=msg, headers=basic(a["email"], d["token"]))
    assert r.status_code == 200 and r.json() == []
    dev = client.get(f"/api/devices/{d['id']}", headers=api.h(a)).json()
    assert dev["location"]["lat"] == 48.1
    assert dev["battery"] == {"level": 0.8, "charging": True, "label": None}
    assert dev["provider_info"]["tid"] == "AB"
    hist = client.get(f"/api/devices/{d['id']}/locations", headers=api.h(a)).json()
    assert hist["points"][0]["speed"] == pytest.approx(10)
    # non-location messages are accepted and ignored
    r = client.post("/api/owntracks", json={"_type": "lwt"}, headers=basic(a["email"], d["token"]))
    assert r.status_code == 200


def test_owntracks_auth(api, client):
    a, b = api.register("A"), api.register("B")
    d = api.device(a, "OT", kind="owntracks")
    msg = {"_type": "location", "lat": 1, "lon": 1, "tst": int(time.time())}
    assert client.post("/api/owntracks", json=msg).status_code == 401
    assert (
        client.post("/api/owntracks", json=msg, headers=basic(b["email"], d["token"])).status_code
        == 401
    )
    browser = api.device(a, "B")
    r = client.post("/api/owntracks", json=msg, headers=basic(a["email"], browser["token"]))
    assert r.status_code == 400


def test_push_subscription_upsert_and_dead_cleanup(api, client, fake_push):
    a = api.register("A")
    sub = {"endpoint": "https://push.example/1", "keys": {"p256dh": "k", "auth": "x"}}
    assert client.post("/api/push/subscriptions", json=sub, headers=api.h(a)).status_code == 201
    assert client.post("/api/push/subscriptions", json=sub, headers=api.h(a)).status_code == 201
    assert client.post("/api/push/test", headers=api.h(a)).json() == {"sent": 1}
    fake_push.status = 410
    assert client.post("/api/push/test", headers=api.h(a)).json() == {"sent": 0}
    fake_push.status = 201
    assert client.post("/api/push/test", headers=api.h(a)).json() == {"sent": 0}  # removed
    bad = {**sub, "endpoint": "http://insecure"}
    assert client.post("/api/push/subscriptions", json=bad, headers=api.h(a)).status_code == 400


def test_vapid_key(client):
    key = client.get("/api/push/vapid-key").json()["public_key"]
    raw = base64.urlsafe_b64decode(key + "=" * (-len(key) % 4))
    assert len(raw) == 65 and raw[0] == 4


def test_secret_box_roundtrip_and_tamper():
    box = SecretBox("k1")
    blob = box.encrypt_json({"password": "hunter2"})
    assert b"hunter2" not in blob
    assert box.decrypt_json(blob) == {"password": "hunter2"}
    with pytest.raises(InvalidToken):
        SecretBox("k2").decrypt(blob)
    with pytest.raises(InvalidToken):
        box.decrypt(blob[:-2] + b"AA")


def test_security_headers(client):
    r = client.get("/api/health")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"
