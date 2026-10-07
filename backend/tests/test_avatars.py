import base64
import re
from datetime import timedelta

from sqlalchemy import update

from app.clock import utcnow
from app.models import Share
from app.services.avatars import MAX_BYTES, sniff

PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64 + b"\xff\xd9"


def upload(client, api, user, data: bytes, name="photo.jpg", ctype="image/jpeg"):
    return client.put("/api/me/avatar", files={"file": (name, data, ctype)}, headers=api.h(user))


def test_upload_serve_replace_and_remove(client, api):
    a = api.register("Alice")
    me = client.get("/api/auth/me", headers=api.h(a)).json()
    assert me["avatar_url"] is None

    r = upload(client, api, a, PNG, "me.png", "image/png")
    assert r.status_code == 200, r.text
    url = r.json()["avatar_url"]
    assert re.fullmatch(rf"/api/users/{a['id']}/avatar\?v=\d+", url)
    assert client.get("/api/auth/me", headers=api.h(a)).json()["avatar_url"] == url

    img = client.get(url, headers=api.h(a))
    assert img.status_code == 200
    assert img.content == PNG
    assert img.headers["content-type"] == "image/png"
    assert img.headers["cache-control"].startswith("private")
    assert img.headers["x-content-type-options"] == "nosniff"

    # A new photo gets a new URL; the type comes from the bytes, not from the client.
    r = upload(client, api, a, JPEG, "trick.png", "image/png")
    assert r.json()["avatar_url"] != url
    img = client.get(r.json()["avatar_url"], headers=api.h(a))
    assert img.headers["content-type"] == "image/jpeg"

    # Renaming keeps the photo.
    r = client.patch("/api/me", json={"display_name": "Alice B."}, headers=api.h(a))
    assert r.json()["avatar_url"] is not None

    r = client.delete("/api/me/avatar", headers=api.h(a))
    assert r.status_code == 200 and r.json()["avatar_url"] is None
    assert client.get(f"/api/users/{a['id']}/avatar", headers=api.h(a)).status_code == 404
    assert client.delete("/api/me/avatar", headers=api.h(a)).status_code == 200


def test_only_raster_images_within_the_limit(client, api):
    a = api.register("Alice")
    assert upload(client, api, a, PNG).status_code == 200
    url = client.get("/api/auth/me", headers=api.h(a)).json()["avatar_url"]

    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    for data, ctype in (
        (svg, "image/svg+xml"),
        (b"<html><body>hi</body></html>", "image/png"),
        (b"", "image/png"),
        (b"BM" + b"\x00" * 60, "image/bmp"),
    ):
        assert upload(client, api, a, data, "x.png", ctype).status_code == 415

    too_big = b"\x89PNG\r\n\x1a\n" + b"\x00" * MAX_BYTES
    assert upload(client, api, a, too_big).status_code == 413
    # Much larger: refused from its Content-Length, before the body is parsed.
    assert upload(client, api, a, too_big * 2).status_code == 413
    # Refused uploads leave the photo as it was.
    assert client.get("/api/auth/me", headers=api.h(a)).json()["avatar_url"] == url
    assert client.get(url, headers=api.h(a)).content == PNG


def test_sniff():
    assert sniff(PNG) == "image/png"
    assert sniff(JPEG) == "image/jpeg"
    assert sniff(b"RIFF\x24\x00\x00\x00WEBPVP8 ") == "image/webp"
    assert sniff(b"GIF89a\x01\x00") == "image/gif"
    assert sniff(b"RIFF\x24\x00\x00\x00WAVEfmt ") is None
    assert sniff(b"<svg/>") is None


def test_photo_visible_to_people_sharing_either_way(client, api, app):
    a, b, stranger = api.register("Alice"), api.register("Bob"), api.register("Eve")
    upload(client, api, a, PNG)
    upload(client, api, b, JPEG)
    url_a = client.get("/api/auth/me", headers=api.h(a)).json()["avatar_url"]
    url_b = client.get("/api/auth/me", headers=api.h(b)).json()["avatar_url"]

    assert client.get(url_a, headers=api.h(stranger)).status_code == 404
    assert client.get(url_a, headers=api.h(b)).status_code == 404
    assert client.get(url_a).status_code == 401

    # Alice shares with Bob: each sees the other's photo, a stranger still does not.
    sid = api.share(a, b)
    assert client.get(url_a, headers=api.h(b)).content == PNG
    assert client.get(url_b, headers=api.h(a)).status_code == 200
    assert client.get(url_a, headers=api.h(stranger)).status_code == 404
    people_b = client.get("/api/people", headers=api.h(b)).json()
    assert people_b[0]["user"]["avatar_url"] == url_a
    shares_a = client.get("/api/shares", headers=api.h(a)).json()
    assert shares_a["outgoing"][0]["recipient"]["avatar_url"] == url_b

    # An expired share no longer shows it.
    async def expire():
        async with app.state.ctx.sessionmaker() as db:
            await db.execute(
                update(Share).where(Share.id == sid).values(expires_at=utcnow() - timedelta(1))
            )
            await db.commit()

    client.portal.call(expire)
    assert client.get(url_a, headers=api.h(b)).status_code == 404
    assert client.get(url_b, headers=api.h(a)).status_code == 404


def test_pending_invitation_shows_the_inviter_only(client, api):
    a, b = api.register("Alice"), api.register("Bob")
    upload(client, api, a, PNG)
    upload(client, api, b, JPEG)
    url_a = client.get("/api/auth/me", headers=api.h(a)).json()["avatar_url"]
    url_b = client.get("/api/auth/me", headers=api.h(b)).json()["avatar_url"]

    sid = api.share(a, b, accept=False)
    # Bob sees who invites him; Alice does not get Bob's photo before he accepts.
    assert client.get(url_a, headers=api.h(b)).status_code == 200
    assert client.get(url_b, headers=api.h(a)).status_code == 404

    client.post(f"/api/shares/{sid}/decline", headers=api.h(b))
    assert client.get(url_a, headers=api.h(b)).status_code == 404

    sid = api.share(a, b)
    assert client.get(url_b, headers=api.h(a)).status_code == 200
    client.delete(f"/api/shares/{sid}", headers=api.h(b))
    assert client.get(url_a, headers=api.h(b)).status_code == 404
    assert client.get(url_b, headers=api.h(a)).status_code == 404
