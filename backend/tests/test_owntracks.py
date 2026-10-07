"""What Oukilé returns to the OwnTracks app: places as waypoints, and a reporting profile."""

import itertools
import time

from tests.test_misc import basic

HOME = {"name": "Home", "lat": 48.8584, "lon": 2.2945, "radius_m": 200}
WORK = {"name": "Work", "lat": 48.8738, "lon": 2.2950, "radius_m": 150.4}
FAR = (48.8650, 2.3200)  # about 2 km from both
ANDROID = {"User-Agent": "Owntracks-Android/gms/420504000"}
IOS = {"User-Agent": "OwnTracks/18.4.1 CFNetwork/1568.200.51 Darwin/24.1.0"}

_tst = itertools.count(int(time.time()) - 3600, 10)


def location(lat, lon):
    return {"_type": "location", "lat": lat, "lon": lon, "acc": 12, "tst": next(_tst), "tid": "AB"}


def transition(event, lat, lon, tst=None):
    return {
        "_type": "transition",
        "event": event,
        "desc": "Home",
        "lat": lat,
        "lon": lon,
        "acc": 15,
        "tst": tst or next(_tst),
        "wtst": 1700000000,
        "t": "c",
        "tid": "AB",
    }


def post(client, user, phone, msg, ua=None) -> list:
    r = client.post(
        "/api/owntracks", json=msg, headers=basic(user["email"], phone["token"]) | (ua or {})
    )
    assert r.status_code == 200, r.text
    return r.json()


def actions(reply: list) -> list[str]:
    assert all(c["_type"] == "cmd" for c in reply)
    return [c["action"] for c in reply]


def places(reply: list) -> list[dict]:
    (cmd,) = [c for c in reply if c["action"] == "setWaypoints"]
    assert cmd["waypoints"]["_type"] == "waypoints"
    return cmd["waypoints"]["waypoints"]


def profile(reply: list) -> dict | None:
    found = [c["configuration"] for c in reply if c["action"] == "setConfiguration"]
    return found[0] if found else None


def zone(api, client, user, body) -> str:
    r = client.post("/api/zones", json=body, headers=api.h(user))
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_places_sent_once_and_only_the_owners(api, client):
    a, b = api.register("A"), api.register("B")
    phone = api.device(a, "Phone", kind="owntracks")
    api.share(a, b)
    zone(api, client, a, HOME)
    zone(api, client, a, WORK)
    # B's place watches A's phone, but it is B's: never sent to A's app.
    zone(api, client, b, {**HOME, "name": "B's office", "device_ids": [phone["id"]]})

    reply = post(client, a, phone, location(*FAR))
    assert actions(reply) == ["clearWaypoints", "setWaypoints"]
    sent = places(reply)
    assert [(p["desc"], p["lat"], p["lon"], p["rad"]) for p in sent] == [
        ("Home", 48.8584, 2.2945, 200),
        ("Work", 48.8738, 2.2950, 150),  # whole metres
    ]
    assert all(p["_type"] == "waypoint" and isinstance(p["tst"], int) for p in sent)
    assert len({p["tst"] for p in sent}) == 2  # created in the same second, still two keys
    # Unchanged: nothing more.
    assert post(client, a, phone, location(*FAR)) == []
    assert post(client, a, phone, {"_type": "lwt"}) == []


def test_places_resent_when_added_edited_or_deleted(api, client):
    a = api.register("A")
    phone = api.device(a, "Phone", kind="owntracks")
    assert post(client, a, phone, location(*FAR)) == []  # no place yet: nothing to clear
    home = zone(api, client, a, HOME)
    first = places(post(client, a, phone, location(*FAR)))
    assert [p["desc"] for p in first] == ["Home"]

    zone(api, client, a, WORK)
    reply = post(client, a, phone, location(*FAR))
    assert actions(reply) == ["clearWaypoints", "setWaypoints"]
    assert [p["desc"] for p in places(reply)] == ["Home", "Work"]

    client.patch(f"/api/zones/{home}", json={"name": "Maison", "radius_m": 250}, headers=api.h(a))
    edited = places(post(client, a, phone, location(*FAR)))
    assert (edited[0]["desc"], edited[0]["rad"], edited[0]["tst"]) == (
        "Maison",
        250,
        first[0]["tst"],
    )
    # Notifications only: the app is not told.
    client.patch(f"/api/zones/{home}", json={"notify_exit": False}, headers=api.h(a))
    assert post(client, a, phone, location(*FAR)) == []

    client.delete(f"/api/zones/{home}", headers=api.h(a))
    reply = post(client, a, phone, location(*FAR))
    assert actions(reply) == ["clearWaypoints", "setWaypoints"]
    assert [p["desc"] for p in places(reply)] == ["Work"]

    for z in client.get("/api/zones", headers=api.h(a)).json():
        client.delete(f"/api/zones/{z['id']}", headers=api.h(a))
    assert actions(post(client, a, phone, location(*FAR))) == ["clearWaypoints"]
    assert post(client, a, phone, location(*FAR)) == []


def test_transition_is_a_position_that_confirms_the_crossing(api, client):
    a = api.register("A")
    phone = api.device(a, "Phone", kind="owntracks")
    zone(api, client, a, HOME)
    post(client, a, phone, location(*FAR))  # outside
    # One plain position inside is not enough (GPS jitter)...
    near = (HOME["lat"] + 0.0002, HOME["lon"])
    post(client, a, phone, location(*near))
    assert client.get("/api/zones/events", headers=api.h(a)).json() == []
    post(client, a, phone, location(*FAR))
    # ...but the app's own region event is: arrival at once.
    tst = next(_tst)
    post(client, a, phone, transition("enter", *near, tst=tst))
    events = client.get("/api/zones/events", headers=api.h(a)).json()
    assert [(e["type"], e["zone_name"]) for e in events] == [("enter", "Home")]
    dev = client.get(f"/api/devices/{phone['id']}", headers=api.h(a)).json()
    assert (dev["location"]["lat"], dev["location"]["accuracy"]) == (near[0], 15)
    # The location the app sends with it (same time) changes nothing.
    post(client, a, phone, {**location(*near), "tst": tst, "t": "c"})
    post(client, a, phone, transition("leave", *FAR))
    events = client.get("/api/zones/events", headers=api.h(a)).json()
    assert [e["type"] for e in reversed(events)] == ["enter", "exit"]
    # iOS leaves out the accuracy when it has none.
    msg = transition("enter", *near)
    del msg["acc"]
    post(client, a, phone, msg)
    assert len(client.get("/api/zones/events", headers=api.h(a)).json()) == 3


def test_profile_follows_the_places_on_android(api, client):
    a = api.register("A")
    phone = api.device(a, "Phone", kind="owntracks")
    zone(api, client, a, HOME)
    reply = post(client, a, phone, location(*FAR), ua=ANDROID)
    assert actions(reply) == ["clearWaypoints", "setWaypoints", "setConfiguration"]
    assert profile(reply) == {
        "_type": "configuration",
        "locatorDisplacement": 100,
        "locatorInterval": 60,
    }
    assert post(client, a, phone, location(*FAR), ua=ANDROID) == []

    reply = post(client, a, phone, transition("enter", HOME["lat"], HOME["lon"]), ua=ANDROID)
    assert reply == [
        {
            "_type": "cmd",
            "action": "setConfiguration",
            "configuration": {
                "_type": "configuration",
                "locatorDisplacement": 500,
                "locatorInterval": 300,
            },
        }
    ]
    assert post(client, a, phone, location(HOME["lat"], HOME["lon"]), ua=ANDROID) == []

    reply = post(client, a, phone, transition("leave", *FAR), ua=ANDROID)
    assert profile(reply)["locatorDisplacement"] == 100
    assert post(client, a, phone, location(*FAR), ua=ANDROID) == []


def test_no_profile_for_ios(api, client):
    a = api.register("A")
    phone = api.device(a, "Phone", kind="owntracks")
    zone(api, client, a, HOME)
    assert actions(post(client, a, phone, location(*FAR), ua=IOS)) == [
        "clearWaypoints",
        "setWaypoints",
    ]
    assert post(client, a, phone, transition("enter", HOME["lat"], HOME["lon"]), ua=IOS) == []


def test_setting_the_app_up_again_resends_everything(api, client):
    a = api.register("A")
    phone = api.device(a, "Phone", kind="owntracks")
    zone(api, client, a, HOME)
    post(client, a, phone, location(*FAR), ua=ANDROID)
    assert post(client, a, phone, location(*FAR), ua=ANDROID) == []
    again = api.device(a, "Phone", kind="owntracks")
    reply = post(client, a, again, location(*FAR), ua=ANDROID)
    assert actions(reply) == ["clearWaypoints", "setWaypoints", "setConfiguration"]
    dev = client.get(f"/api/devices/{again['id']}", headers=api.h(a)).json()
    assert dev["provider_info"] == {"tid": "AB"}  # the bookkeeping stays private
