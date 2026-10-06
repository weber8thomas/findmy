from datetime import UTC, datetime, timedelta

from sqlalchemy import update

from app.clock import utcnow
from app.models import Share


def test_invite_accept_people_and_stop(api, client, fake_push):
    a, b = api.register("Alice"), api.register("Bob")
    d = api.device(a, "Alice phone")
    api.report(d, 48.8584, 2.2945)

    sid = api.share(a, b, accept=False)
    shares_b = client.get("/api/shares", headers=api.h(b)).json()
    assert shares_b["incoming"][0]["status"] == "pending"
    people_b = client.get("/api/people", headers=api.h(b)).json()
    assert people_b[0]["location"] is None  # not accepted yet
    notes = client.get("/api/notifications", headers=api.h(b)).json()
    assert notes[0]["kind"] == "share_invite"

    assert client.post(f"/api/shares/{sid}/accept", headers=api.h(b)).status_code == 200
    people_b = client.get("/api/people", headers=api.h(b)).json()
    assert people_b[0]["user"]["display_name"] == "Alice"
    assert people_b[0]["location"]["lat"] == 48.8584
    assert people_b[0]["device_name"] == "Alice phone"
    # Alice sees Bob as someone she shares with, but no location for Bob.
    people_a = client.get("/api/people", headers=api.h(a)).json()
    assert people_a[0]["i_share_with"]["status"] == "accepted"
    assert people_a[0]["location"] is None
    viewers = client.get("/api/me/viewers", headers=api.h(a)).json()
    assert [v["recipient"]["display_name"] for v in viewers] == ["Bob"]

    assert client.delete(f"/api/shares/{sid}", headers=api.h(a)).status_code == 200
    assert client.get("/api/people", headers=api.h(b)).json() == []
    assert client.get("/api/me/viewers", headers=api.h(a)).json() == []


def test_cannot_accept_someone_elses_invite(api, client):
    a, b, c = api.register("A"), api.register("B"), api.register("C")
    sid = api.share(a, b, accept=False)
    assert client.post(f"/api/shares/{sid}/accept", headers=api.h(c)).status_code == 404
    assert client.post(f"/api/shares/{sid}/accept", headers=api.h(a)).status_code == 404
    assert client.delete(f"/api/shares/{sid}", headers=api.h(c)).status_code == 404


def test_duplicate_and_self_share(api, client):
    a, b = api.register("A"), api.register("B")
    api.share(a, b, accept=False)
    r = client.post("/api/shares", json={"recipient_email": b["email"]}, headers=api.h(a))
    assert r.status_code == 409
    r = client.post("/api/shares", json={"recipient_email": a["email"]}, headers=api.h(a))
    assert r.status_code == 400
    r = client.post("/api/shares", json={"recipient_email": "ghost@example.com"}, headers=api.h(a))
    assert r.status_code == 404


def test_expired_share_hides_location(api, client, app):
    a, b = api.register("A"), api.register("B")
    d = api.device(a)
    api.report(d, 1, 1)
    expires = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    sid = api.share(a, b, expires_at=expires)
    assert client.get("/api/people", headers=api.h(b)).json()[0]["location"] is not None

    async def expire():
        async with app.state.ctx.sessionmaker() as db:
            await db.execute(
                update(Share)
                .where(Share.id == sid)
                .values(expires_at=utcnow() - timedelta(seconds=1))
            )
            await db.commit()

    client.portal.call(expire)
    assert client.get("/api/people", headers=api.h(b)).json() == []
    # recipient cannot see it via device endpoints either
    assert client.get(f"/api/devices/{d['id']}", headers=api.h(b)).status_code == 404


def test_recipient_can_remove_person(api, client):
    a, b = api.register("A"), api.register("B")
    sid = api.share(a, b)
    assert client.delete(f"/api/shares/{sid}", headers=api.h(b)).status_code == 200
    assert client.get("/api/people", headers=api.h(b)).json() == []


def test_primary_device_switch(api, client):
    a, b = api.register("A"), api.register("B")
    phone = api.device(a, "Phone")
    laptop = api.device(a, "Laptop", kind="browser")
    api.report(phone, 1, 1)
    api.report(laptop, 2, 2)
    api.share(a, b)
    assert client.get("/api/people", headers=api.h(b)).json()[0]["location"]["lat"] == 1
    client.patch("/api/me", json={"primary_device_id": laptop["id"]}, headers=api.h(a))
    assert client.get("/api/people", headers=api.h(b)).json()[0]["location"]["lat"] == 2
