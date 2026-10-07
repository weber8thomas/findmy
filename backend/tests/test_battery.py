"""Low battery alerts: to the people who see me, about the phone my location comes from."""

from datetime import UTC, datetime


def battery_notes(client, api, user) -> list[dict]:
    notes = client.get("/api/notifications", headers=api.h(user)).json()
    return [n for n in notes if n["kind"] == "battery_low"]


def charge(client, device, level, charging=False):
    r = client.post(
        "/api/report/locations",
        json={
            "fixes": [
                {"ts": datetime.now(UTC).isoformat(), "lat": 48.85, "lon": 2.35, "accuracy": 10}
            ],
            "battery": {"level": level, "charging": charging},
        },
        headers={"Authorization": f"Bearer {device['token']}"},
    )
    assert r.status_code == 202, r.text


def alerts_on(client, api, user, on=True):
    r = client.patch("/api/me/prefs", json={"battery_alerts": on}, headers=api.h(user))
    assert r.status_code == 200, r.text
    assert r.json() == {"battery_alerts": on}


def test_off_unless_chosen(api, client):
    a, b = api.register("Alice"), api.register("Bob")
    phone = api.device(a, "iPhone")
    api.share(a, b)
    assert client.get("/api/me/prefs", headers=api.h(a)).json() == {"battery_alerts": False}
    charge(client, phone, 0.5)
    charge(client, phone, 0.1)
    assert battery_notes(client, api, b) == []


def test_the_people_who_see_me_hear_of_it_once(api, client):
    a, b, c = api.register("Alice"), api.register("Bob"), api.register("Carol")
    phone = api.device(a, "iPhone")
    api.share(a, b)
    alerts_on(client, api, a)
    charge(client, phone, 0.5)
    charge(client, phone, 0.16)
    assert battery_notes(client, api, b) == []
    charge(client, phone, 0.14)
    (note,) = battery_notes(client, api, b)
    assert note["payload"]["title"] == "Alice: low battery"
    assert note["payload"]["body"].startswith("iPhone is down to 14%")
    # Not to me, nor to someone who does not see me.
    assert battery_notes(client, api, a) == battery_notes(client, api, c) == []
    # Still low, or wavering around the threshold: said once.
    charge(client, phone, 0.12)
    charge(client, phone, 0.15)
    charge(client, phone, 0.14)
    assert len(battery_notes(client, api, b)) == 1


def test_nothing_while_charging_or_when_first_seen_low(api, client):
    a, b = api.register("Alice"), api.register("Bob")
    phone = api.device(a, "iPhone")
    api.share(a, b)
    alerts_on(client, api, a)
    charge(client, phone, 0.1)  # first known level: it did not fall
    charge(client, phone, 0.3, charging=True)
    charge(client, phone, 0.12, charging=True)
    assert battery_notes(client, api, b) == []


def test_only_the_device_my_location_comes_from(api, client):
    a, b = api.register("Alice"), api.register("Bob")
    phone = api.device(a, "iPhone")
    tablet = api.device(a, "iPad")
    r = client.put(
        "/api/me/sources", json={"device_ids": [phone["id"], tablet["id"]]}, headers=api.h(a)
    )
    assert r.status_code == 200, r.text
    api.share(a, b)
    alerts_on(client, api, a)
    charge(client, phone, 0.8)
    charge(client, tablet, 0.5)
    charge(client, tablet, 0.1)  # the phone is fresh: my location comes from it
    assert battery_notes(client, api, b) == []
    charge(client, phone, 0.1)
    assert len(battery_notes(client, api, b)) == 1


def test_french(api, client):
    a, b = api.register("Lucía", locale="fr"), api.register("Marco", locale="fr")
    phone = api.device(a, "iPhone")
    api.share(a, b)
    alerts_on(client, api, a)
    charge(client, phone, 0.2)
    charge(client, phone, 0.09)
    (note,) = battery_notes(client, api, b)
    assert note["payload"]["title"] == "Lucía : batterie faible"
    assert note["payload"]["body"].startswith("iPhone n'a plus que 9 %")
