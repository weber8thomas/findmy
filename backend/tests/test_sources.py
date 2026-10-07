from datetime import timedelta

from sqlalchemy import func, select, update

from app.models import Device, DeviceKind, LocationSource
from tests.conftest import ago
from tests.test_realtime import recv_until

HOME = {"name": "Home", "lat": 48.8584, "lon": 2.2945, "radius_m": 200}
FAR = (48.8700, 2.2945)


def add_tag(app, client, user: dict, name: str, lat: float, lon: float, ts) -> str:
    """A Find My network tag with a position, as the provider would leave it."""

    async def insert():
        async with app.state.ctx.sessionmaker() as db:
            tag = Device(
                owner_id=user["id"],
                name=name,
                kind=DeviceKind.FINDMY,
                icon="wallet",
                provider_config={},
                last_lat=lat,
                last_lon=lon,
                last_accuracy=20,
                last_fix_at=ts,
                last_seen_at=ts,
            )
            db.add(tag)
            await db.commit()
            return tag.id

    return client.portal.call(insert)


def age(app, client, device: dict, ts) -> None:
    """The device's last position and check-in date back to `ts` (a report counts as one)."""

    async def run():
        async with app.state.ctx.sessionmaker() as db:
            await db.execute(
                update(Device)
                .where(Device.id == device["id"])
                .values(last_fix_at=ts, last_seen_at=ts)
            )
            await db.commit()

    client.portal.call(run)


def put_sources(client, api, user: dict, ids: list[str]):
    return client.put("/api/me/sources", json={"device_ids": ids}, headers=api.h(user))


def my_location(client, api, user: dict) -> dict:
    return client.get("/api/me/location", headers=api.h(user)).json()


def test_without_sources_the_primary_device_is_used(api, client):
    a = api.register("A")
    phone = api.device(a, "Phone")
    api.report(phone, 48.85, 2.35)
    assert client.get("/api/me/sources", headers=api.h(a)).json() == {"device_ids": [phone["id"]]}
    loc = my_location(client, api, a)
    assert loc["device_id"] == phone["id"] and loc["device_name"] == "Phone"
    assert loc["location"]["lat"] == 48.85
    # An empty list goes back to the primary device alone.
    r = put_sources(client, api, a, [])
    assert r.status_code == 200 and r.json() == {"device_ids": [phone["id"]]}
    assert my_location(client, api, a)["device_id"] == phone["id"]


def test_no_device_no_location(api, client):
    a = api.register("A")
    assert client.get("/api/me/sources", headers=api.h(a)).json() == {"device_ids": []}
    assert my_location(client, api, a) == {"location": None, "device_id": None, "device_name": None}


def test_first_fresh_source_in_order_wins(api, client, app):
    a = api.register("A")
    phone = api.device(a, "Phone")
    api.report(phone, 48.85, 2.35, ts=ago(minutes=2))
    tag = add_tag(app, client, a, "Wallet", 48.80, 2.30, ago(minutes=5))

    r = put_sources(client, api, a, [tag, phone["id"]])
    assert r.status_code == 200 and r.json() == {"device_ids": [tag, phone["id"]]}
    assert my_location(client, api, a)["device_id"] == tag
    # The first source becomes the primary device (zones and access rules go by it).
    me = client.get("/api/auth/me", headers=api.h(a)).json()
    assert me["primary_device_id"] == tag

    put_sources(client, api, a, [phone["id"], tag])
    assert my_location(client, api, a)["device_name"] == "Phone"


def test_stale_first_source_falls_back_to_the_next(api, client, app):
    a, b = api.register("A"), api.register("B")
    phone = api.device(a, "Fairphone5")
    api.report(phone, 48.85, 2.35)
    age(app, client, phone, ago(minutes=45))
    tag = add_tag(app, client, a, "Wallet", 48.80, 2.30, ago(minutes=10))
    put_sources(client, api, a, [phone["id"], tag])
    api.share(a, b)

    assert my_location(client, api, a)["device_name"] == "Wallet"
    person = client.get("/api/people", headers=api.h(b)).json()[0]
    assert person["location"]["lat"] == 48.80
    assert person["device_name"] == "Wallet"
    # A viewer sees one position and a device name, never the list of devices.
    assert set(person) == {"user", "sharing_with_me", "i_share_with", "location", "device_name"}
    assert client.get("/api/me/sources", headers=api.h(b)).json() == {"device_ids": []}


def test_nothing_fresh_takes_the_most_recent(api, client, app):
    a = api.register("A")
    phone = api.device(a, "Phone")
    api.report(phone, 48.85, 2.35)
    age(app, client, phone, ago(hours=2))
    tag = add_tag(app, client, a, "Wallet", 48.80, 2.30, ago(hours=5))
    put_sources(client, api, a, [tag, phone["id"]])
    assert my_location(client, api, a)["device_name"] == "Phone"


def test_a_check_in_does_not_refresh_a_source(api, client, app):
    a = api.register("A")
    phone = api.device(a, "Phone")
    api.report(phone, 48.85, 2.35)
    age(app, client, phone, ago(hours=1))
    tag = add_tag(app, client, a, "Wallet", 48.80, 2.30, ago(minutes=5))
    put_sources(client, api, a, [phone["id"], tag])
    assert my_location(client, api, a)["device_name"] == "Wallet"
    # A ping without a new position proves nothing: OwnTracks sends one every 15 minutes with
    # its last fix, even after moving less than its reporting threshold (500 m by default).
    r = client.post(
        "/api/report/locations",
        json={"fixes": []},
        headers={"Authorization": f"Bearer {phone['token']}"},
    )
    assert r.status_code == 202
    assert my_location(client, api, a)["device_name"] == "Wallet"


def test_sources_must_be_my_own_distinct_devices(api, client):
    a, b = api.register("A"), api.register("B")
    mine = api.device(a, "Phone")
    theirs = api.device(b, "Their phone")
    assert put_sources(client, api, a, [mine["id"], theirs["id"]]).status_code == 404
    assert put_sources(client, api, a, ["nope"]).status_code == 404
    assert put_sources(client, api, a, [mine["id"], mine["id"]]).status_code == 422
    many = [api.device(a, f"D{i}")["id"] for i in range(5)]
    assert put_sources(client, api, a, [mine["id"], *many]).status_code == 422
    # Nothing was saved.
    assert client.get("/api/me/sources", headers=api.h(a)).json() == {"device_ids": [mine["id"]]}


def test_deleting_a_source_removes_it(api, client, app):
    a, b = api.register("A"), api.register("B")
    phone = api.device(a, "Phone")
    api.report(phone, 48.85, 2.35)
    tag = add_tag(app, client, a, "Wallet", 48.80, 2.30, ago(minutes=5))
    put_sources(client, api, a, [phone["id"], tag])
    api.share(a, b)

    assert client.delete(f"/api/devices/{phone['id']}", headers=api.h(a)).status_code == 204
    assert client.get("/api/me/sources", headers=api.h(a)).json() == {"device_ids": [tag]}
    assert client.get("/api/auth/me", headers=api.h(a)).json()["primary_device_id"] == tag
    assert client.get("/api/people", headers=api.h(b)).json()[0]["device_name"] == "Wallet"

    async def rows():
        async with app.state.ctx.sessionmaker() as db:
            return (await db.execute(select(func.count()).select_from(LocationSource))).scalar()

    assert client.portal.call(rows) == 1
    client.delete(f"/api/devices/{tag}", headers=api.h(a))
    assert client.portal.call(rows) == 0
    assert client.get("/api/auth/me", headers=api.h(a)).json()["primary_device_id"] is None


def test_choosing_the_primary_device_moves_it_first(api, client, app):
    a = api.register("A")
    phone = api.device(a, "Phone")
    tag = add_tag(app, client, a, "Wallet", 48.80, 2.30, ago(minutes=5))
    watch = api.device(a, "Watch")
    put_sources(client, api, a, [phone["id"], tag])
    client.patch("/api/me", json={"primary_device_id": watch["id"]}, headers=api.h(a))
    assert client.get("/api/me/sources", headers=api.h(a)).json() == {
        "device_ids": [watch["id"], phone["id"], tag]
    }


def test_a_new_phone_keeps_sources_ordered_by_hand(api, client, app):
    a = api.register("A")
    laptop = api.device(a, "Laptop")
    tag = add_tag(app, client, a, "Wallet", 48.80, 2.30, ago(minutes=5))
    put_sources(client, api, a, [tag, laptop["id"]])
    api.device(a, "OwnTracks", kind="owntracks")
    assert client.get("/api/auth/me", headers=api.h(a)).json()["primary_device_id"] == tag


def test_viewers_follow_the_source_in_use_live(api, client, app):
    a, b = api.register("A"), api.register("B")
    phone = api.device(a, "Phone")
    watch = api.device(a, "Watch")
    api.report(phone, 48.85, 2.35)
    age(app, client, phone, ago(hours=1))
    put_sources(client, api, a, [phone["id"], watch["id"]])
    api.share(a, b)
    with (
        client.websocket_connect("/api/ws", headers=api.h(b)) as viewer,
        client.websocket_connect("/api/ws", headers=api.h(a)) as owner,
    ):
        api.report(watch, 48.86, 2.36)  # the phone is stale: the watch takes over
        data = recv_until(viewer, "person.location")
        assert data["user_id"] == a["id"] and data["device_name"] == "Watch"
        assert data["location"]["lat"] == 48.86
        assert "device_id" not in data
        mine = recv_until(owner, "me.location")
        assert mine["device_id"] == watch["id"]

        api.report(phone, 48.87, 2.37)  # the phone is back
        data = recv_until(viewer, "person.location")
        assert data["device_name"] == "Phone" and data["location"]["lat"] == 48.87


def test_zone_alerts_follow_the_first_source_only(api, client):
    alice, bob = api.register("Alice"), api.register("Bob")
    phone = api.device(alice, "Phone")
    watch = api.device(alice, "Watch")
    put_sources(client, api, alice, [phone["id"], watch["id"]])
    api.share(alice, bob)
    client.post("/api/zones", json=HOME, headers=api.h(bob))

    def walk(device, points):
        base = ago(minutes=30)
        for i, (lat, lon) in enumerate(points):
            api.report(device, lat, lon, ts=base + timedelta(minutes=i))

    home = (HOME["lat"], HOME["lon"])
    walk(watch, [FAR, home, home])
    assert client.get("/api/zones/events", headers=api.h(bob)).json() == []
    walk(phone, [FAR, home, home])
    events = client.get("/api/zones/events", headers=api.h(bob)).json()
    assert [e["type"] for e in events] == ["enter"]
