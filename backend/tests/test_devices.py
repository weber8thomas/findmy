from datetime import UTC, datetime, timedelta

from tests.conftest import ago


def test_create_device_sets_primary_and_token_once(api, client):
    a = api.register()
    d = api.device(a, "Alice phone")
    assert d["token"].startswith("dt_")
    me = client.get("/api/auth/me", headers=api.h(a)).json()
    assert me["primary_device_id"] == d["id"]
    devs = client.get("/api/devices", headers=api.h(a)).json()
    assert len(devs) == 1
    assert devs[0]["is_primary"] is True
    assert "play_sound" in devs[0]["capabilities"]
    assert "token" not in str(devs[0]).lower().replace("token_", "")


def test_report_updates_latest_and_dedups(api, client):
    a = api.register()
    d = api.device(a)
    ts = datetime.now(UTC)
    assert api.report(d, 48.85, 2.29, ts=ts, battery=0.5).status_code == 202
    assert api.report(d, 48.85, 2.29, ts=ts).status_code == 202  # duplicate ts ignored
    dev = client.get(f"/api/devices/{d['id']}", headers=api.h(a)).json()
    assert dev["location"]["lat"] == 48.85
    assert dev["battery"]["level"] == 0.5
    hist = client.get(f"/api/devices/{d['id']}/locations", headers=api.h(a)).json()
    assert hist["total"] == 1


def test_older_fix_does_not_move_device(api, client):
    a = api.register()
    d = api.device(a)
    api.report(d, 1.0, 1.0)
    api.report(d, 2.0, 2.0, ts=ago(minutes=10))
    dev = client.get(f"/api/devices/{d['id']}", headers=api.h(a)).json()
    assert dev["location"]["lat"] == 1.0


def test_report_validation(api, client):
    a = api.register()
    d = api.device(a)
    assert api.report(d, 91, 0).status_code == 422
    r = client.post(
        "/api/report/locations",
        json={"fixes": [{"ts": "2024-01-01T00:00:00", "lat": 0, "lon": 0}]},
        headers={"Authorization": f"Bearer {d['token']}"},
    )
    assert r.status_code == 422  # naive timestamp
    r = client.post(
        "/api/report/locations", json={"fixes": []}, headers={"Authorization": "Bearer dt_nope"}
    )
    assert r.status_code == 401


def test_future_timestamp_clamped_and_old_rejected(api, client):
    a = api.register()
    d = api.device(a)
    api.report(d, 1, 1, ts=datetime.now(UTC) + timedelta(days=2))
    dev = client.get(f"/api/devices/{d['id']}", headers=api.h(a)).json()
    assert datetime.fromisoformat(dev["location"]["ts"]) < datetime.now(UTC) + timedelta(minutes=1)
    r = api.report(d, 1, 1, ts=ago(days=30))
    assert r.json()["accepted"] == 0


def test_rotate_token(api, client):
    a = api.register()
    d = api.device(a)
    r = client.post(f"/api/devices/{d['id']}/rotate-token", headers=api.h(a))
    new = r.json()["device_token"]
    assert api.report(d, 1, 1).status_code == 401
    assert api.report({"token": new}, 1, 1).status_code == 202


def test_history_downsampling(api, client):
    a = api.register()
    d = api.device(a)
    start = ago(hours=2)
    fixes = [
        {"ts": (start + timedelta(minutes=i)).isoformat(), "lat": 48 + i / 1000, "lon": 2}
        for i in range(100)
    ]
    client.post(
        "/api/report/locations",
        json={"fixes": fixes},
        headers={"Authorization": f"Bearer {d['token']}"},
    )
    r = client.get(
        f"/api/devices/{d['id']}/locations",
        params={"max_points": 10, "from": ago(hours=3).isoformat()},
        headers=api.h(a),
    ).json()
    assert r["total"] == 100
    assert len(r["points"]) <= 11
    assert r["points"][-1]["lat"] == 48 + 99 / 1000  # last point always kept


def test_delete_device_clears_primary(api, client):
    a = api.register()
    d = api.device(a)
    assert client.delete(f"/api/devices/{d['id']}", headers=api.h(a)).status_code == 204
    assert client.get("/api/auth/me", headers=api.h(a)).json()["primary_device_id"] is None
    assert api.report(d, 1, 1).status_code == 401


def test_access_matrix(api, client):
    """Strangers get 404 everywhere; share recipients see location only."""
    a, b, stranger = api.register("A"), api.register("B"), api.register("S")
    d = api.device(a)
    api.report(d, 1, 1)
    api.share(a, b)
    for who in (b, stranger):
        h = api.h(who)
        assert client.get(f"/api/devices/{d['id']}", headers=h).status_code == 404
        assert client.get(f"/api/devices/{d['id']}/locations", headers=h).status_code == 404
        r = client.post(f"/api/devices/{d['id']}/commands", json={"type": "play_sound"}, headers=h)
        assert r.status_code == 404
        assert (
            client.patch(f"/api/devices/{d['id']}", json={"name": "x"}, headers=h).status_code
            == 404
        )
        assert client.delete(f"/api/devices/{d['id']}", headers=h).status_code == 404
    people_b = client.get("/api/people", headers=api.h(b)).json()
    assert people_b[0]["location"]["lat"] == 1
    assert client.get("/api/people", headers=api.h(stranger)).json() == []
    # cannot pick someone else's device as primary
    r = client.patch("/api/me", json={"primary_device_id": d["id"]}, headers=api.h(b))
    assert r.status_code == 404
