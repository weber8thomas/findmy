from datetime import timedelta

from tests.conftest import ago

HOME = {"name": "Home", "lat": 48.8584, "lon": 2.2945, "radius_m": 200}
FAR = (48.8700, 2.2945)


def walk(api, device, points, start_minutes_ago=30):
    base = ago(minutes=start_minutes_ago)
    for i, (lat, lon) in enumerate(points):
        assert api.report(device, lat, lon, ts=base + timedelta(minutes=i)).status_code == 202


def test_zone_crud_and_validation(api, client):
    a, b = api.register("A"), api.register("B")
    r = client.post("/api/zones", json=HOME, headers=api.h(a))
    assert r.status_code == 201
    zid = r.json()["id"]
    assert (
        client.post("/api/zones", json={**HOME, "radius_m": 10}, headers=api.h(a)).status_code
        == 422
    )
    bd = api.device(b)
    r = client.post("/api/zones", json={**HOME, "device_ids": [bd["id"]]}, headers=api.h(a))
    assert r.status_code == 400  # not visible to A
    assert (
        client.patch(f"/api/zones/{zid}", json={"name": "x"}, headers=api.h(b)).status_code == 404
    )
    r = client.patch(f"/api/zones/{zid}", json={"radius_m": 300}, headers=api.h(a))
    assert r.json()["radius_m"] == 300
    assert client.delete(f"/api/zones/{zid}", headers=api.h(a)).status_code == 204


def test_arrive_and_leave_own_device(api, client, fake_push):
    a = api.register("A")
    d = api.device(a, "Phone")
    client.post("/api/zones", json=HOME, headers=api.h(a))
    sub = {"endpoint": "https://push.example/a", "keys": {"p256dh": "k", "auth": "x"}}
    client.post("/api/push/subscriptions", json=sub, headers=api.h(a))

    walk(api, d, [FAR, FAR, (48.8584, 2.2945), (48.8585, 2.2946), FAR, FAR])
    events = client.get("/api/zones/events", headers=api.h(a)).json()
    assert [e["type"] for e in reversed(events)] == ["enter", "exit"]
    notes = client.get("/api/notifications", headers=api.h(a)).json()
    kinds = [n["kind"] for n in notes]
    assert "zone_enter" in kinds and "zone_exit" in kinds
    bodies = [p["body"] for _, p in fake_push.sent]
    assert "Phone arrived at Home" in bodies


def test_zone_on_shared_person_localised(api, client, fake_push):
    alice, bob = api.register("Alice"), api.register("Bob", locale="fr")
    d = api.device(alice, "Alice phone")
    api.share(alice, bob)
    client.post("/api/zones", json={**HOME, "name": "École"}, headers=api.h(bob))
    sub = {"endpoint": "https://push.example/bob", "keys": {"p256dh": "k", "auth": "x"}}
    client.post("/api/push/subscriptions", json=sub, headers=api.h(bob))
    walk(api, d, [FAR, (48.8584, 2.2945), (48.8584, 2.2945)])
    bob_bodies = [p["body"] for ep, p in fake_push.sent if ep.endswith("/bob")]
    assert "Alice est arrivé(e) à École" in bob_bodies


def test_notify_flags_respected(api, client):
    a = api.register("A")
    d = api.device(a)
    client.post("/api/zones", json={**HOME, "notify_enter": False}, headers=api.h(a))
    walk(api, d, [FAR, (48.8584, 2.2945), (48.8584, 2.2945)])
    assert len(client.get("/api/zones/events", headers=api.h(a)).json()) == 1
    notes = client.get("/api/notifications", headers=api.h(a)).json()
    assert not any(n["kind"] == "zone_enter" for n in notes)


def test_mark_notifications_read(api, client):
    a, b = api.register("A"), api.register("B")
    api.share(a, b, accept=False)
    assert len(client.get("/api/notifications?unread=true", headers=api.h(b)).json()) == 1
    client.post("/api/notifications/read", json={"all": True}, headers=api.h(b))
    assert client.get("/api/notifications?unread=true", headers=api.h(b)).json() == []
