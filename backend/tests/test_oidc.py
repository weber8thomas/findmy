from __future__ import annotations

import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

from app.services.avatars import MAX_BYTES
from app.services.oidc import OidcError, parse_id_token

ISSUER = "https://idp.test/application/o/oukile/"
CLIENT_ID = "oukile-client"
SECRET = "s3cret"


def _b64(value: dict) -> str:
    return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b"=").decode()


def make_id_token(**claims) -> str:
    return f"{_b64({'alg': 'RS256'})}.{_b64(claims)}.signature"


class FakeIdp:
    """Discovery, token and userinfo endpoints of an OpenID provider."""

    def __init__(self) -> None:
        self.claims: dict = {"sub": "u-1", "email": "Alice@Example.com", "name": "Alice"}
        self.userinfo: dict = {}
        self.challenge = ""
        self.nonce = ""
        # Profile pictures served from https://cdn.test/<path>.
        self.pictures: dict[str, httpx.Response] = {}

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.url.host == "cdn.test":
            return self.pictures.get(path, httpx.Response(404))
        if path.endswith("/.well-known/openid-configuration"):
            return httpx.Response(
                200,
                json={
                    "issuer": ISSUER,
                    "authorization_endpoint": "https://idp.test/application/o/authorize/",
                    "token_endpoint": "https://idp.test/application/o/token/",
                    "userinfo_endpoint": "https://idp.test/application/o/userinfo/",
                },
            )
        if path.endswith("/token/"):
            form = parse_qs(request.content.decode())
            basic = base64.b64encode(f"{CLIENT_ID}:{SECRET}".encode()).decode()
            if request.headers.get("authorization") != f"Basic {basic}":
                return httpx.Response(401, json={"error": "invalid_client"})
            digest = hashlib.sha256(form["code_verifier"][0].encode()).digest()
            if base64.urlsafe_b64encode(digest).rstrip(b"=").decode() != self.challenge:
                return httpx.Response(400, json={"error": "invalid_grant"})
            token = make_id_token(
                iss=ISSUER, aud=CLIENT_ID, exp=time.time() + 300, nonce=self.nonce, **self.claims
            )
            return httpx.Response(200, json={"id_token": token, "access_token": "at"})
        if path.endswith("/userinfo/"):
            return httpx.Response(200, json={"sub": self.claims["sub"], **self.userinfo})
        return httpx.Response(404)


@pytest.fixture
def settings(settings):
    settings.oidc_issuer = ISSUER
    settings.oidc_client_id = CLIENT_ID
    settings.oidc_client_secret = SECRET
    settings.oidc_name = "Authentik"
    return settings


@pytest.fixture
def idp(app) -> FakeIdp:
    fake = FakeIdp()
    app.state.ctx.extras["oidc"].transport = httpx.MockTransport(fake.handler)
    return fake


def sso(client, idp: FakeIdp, **query) -> httpx.Response:
    """Sign in through the provider; the response of the callback."""
    r = client.get("/api/auth/oidc/login", follow_redirects=False)
    assert r.status_code == 302, r.text
    location = urlparse(r.headers["location"])
    assert location.netloc == "idp.test"
    q = parse_qs(location.query)
    assert q["client_id"] == [CLIENT_ID]
    assert q["code_challenge_method"] == ["S256"]
    assert q["redirect_uri"] == ["http://testserver/api/auth/oidc/callback"]
    idp.challenge, idp.nonce = q["code_challenge"][0], idp.nonce or q["nonce"][0]
    params = {"code": "the-code", "state": q["state"][0], **query}
    return client.get("/api/auth/oidc/callback", params=params, follow_redirects=False)


def test_config_announces_sso(client):
    auth = client.get("/api/config").json()["auth"]
    assert auth == {
        "password": True,
        "oidc": {"name": "Authentik", "login_url": "/api/auth/oidc/login"},
    }


def test_first_sso_user_is_admin_and_signs_in_again(client, idp):
    r = sso(client, idp)
    assert r.status_code == 303 and r.headers["location"] == "/"
    assert "oukile_oidc" not in client.cookies
    me = client.get("/api/auth/me").json()
    assert me["email"] == "alice@example.com"
    assert me["display_name"] == "Alice"
    assert me["is_admin"] is True

    # Same subject, new email at the provider: same account.
    client.cookies.clear()
    idp.claims["email"] = "alice@new.example"
    idp.nonce = ""
    assert sso(client, idp).status_code == 303
    assert client.get("/api/auth/me").json()["id"] == me["id"]


def test_sso_links_an_existing_account_by_email(client, api, idp):
    bob = api.register("Bob")
    idp.claims = {"sub": "u-2", "email": bob["email"].upper(), "name": "Robert"}
    assert sso(client, idp).headers["location"] == "/"
    me = client.get("/api/auth/me").json()
    assert me["id"] == bob["id"]
    assert me["display_name"] == "Bob"

    # A second provider account with the same email does not take it over.
    client.cookies.clear()
    idp.claims["sub"], idp.nonce = "u-3", ""
    assert sso(client, idp).headers["location"] == "/login?sso_error=no_account"


def test_sso_follows_registration_settings(app, client, api, idp):
    api.register("Admin")
    app.state.ctx.settings.allow_registration = False
    assert sso(client, idp).headers["location"] == "/login?sso_error=no_account"

    app.state.ctx.settings.oidc_registration = True
    idp.nonce = ""
    assert sso(client, idp).headers["location"] == "/"
    me = client.get("/api/auth/me").json()
    assert me["email"] == "alice@example.com" and me["is_admin"] is False


def test_sso_takes_the_email_from_userinfo(client, idp):
    idp.claims = {"sub": "u-4", "preferred_username": "lucia"}
    idp.userinfo = {"email": "lucia@example.com"}
    assert sso(client, idp).headers["location"] == "/"
    me = client.get("/api/auth/me").json()
    assert (me["email"], me["display_name"]) == ("lucia@example.com", "lucia")


def test_sso_new_account_language(app, client, idp):
    app.state.ctx.settings.default_locale = "fr"
    assert client.get("/api/config").json()["default_locale"] == "fr"
    assert sso(client, idp).headers["location"] == "/"
    assert client.get("/api/auth/me").json()["locale"] == "fr"


def test_sso_without_email_is_refused(client, idp):
    idp.claims = {"sub": "u-5"}
    assert sso(client, idp).headers["location"] == "/login?sso_error=no_account"


def test_sso_rejects_a_wrong_state_or_nonce(client, idp):
    assert sso(client, idp, state="forged").headers["location"] == "/login?sso_error=failed"

    client.cookies.clear()
    r = client.get(
        "/api/auth/oidc/callback", params={"code": "c", "state": "s"}, follow_redirects=False
    )
    assert r.headers["location"] == "/login?sso_error=failed"

    idp.nonce = "another-nonce"
    assert sso(client, idp).headers["location"] == "/login?sso_error=failed"
    assert client.get("/api/auth/me").status_code == 401


def test_sso_refused_at_the_provider(client, idp):
    r = client.get("/api/auth/oidc/callback?error=access_denied", follow_redirects=False)
    assert r.headers["location"] == "/login?sso_error=denied"


def test_provider_unreachable(app, client):
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    app.state.ctx.extras["oidc"].transport = httpx.MockTransport(down)
    r = client.get("/api/auth/oidc/login", follow_redirects=False)
    assert r.headers["location"] == "/login?sso_error=failed"


def test_password_login_can_be_turned_off(app, client, idp):
    app.state.ctx.settings.password_login = False
    assert client.get("/api/config").json()["auth"]["password"] is False
    creds = {"email": "x@example.com", "password": "secret123", "display_name": "X"}
    assert client.post("/api/auth/register", json=creds).status_code == 403
    assert client.post("/api/auth/login", json=creds).status_code == 403
    assert sso(client, idp).headers["location"] == "/"


def test_parse_id_token_checks_claims():
    now = time.time()
    good = {"iss": ISSUER, "aud": [CLIENT_ID, "other"], "exp": now + 60, "nonce": "n", "sub": "1"}

    def parse(**changes):
        return parse_id_token(
            make_id_token(**{**good, **changes}), issuer=ISSUER, client_id=CLIENT_ID, nonce="n"
        )

    assert parse()["sub"] == "1"
    for changes in (
        {"iss": "https://evil.test/"},
        {"aud": "someone-else"},
        {"exp": now - 3600},
        {"nonce": "x"},
        {"sub": ""},
    ):
        with pytest.raises(OidcError):
            parse(**changes)
    with pytest.raises(OidcError):
        parse_id_token("not-a-jwt", issuer=ISSUER, client_id=CLIENT_ID, nonce="n")


PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
)
JPEG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 64 + b"\xff\xd9"


def sso_again(client, idp: FakeIdp) -> dict:
    """Sign in once more; the signed-in user."""
    client.cookies.clear()
    idp.nonce = ""
    assert sso(client, idp).headers["location"] == "/"
    return client.get("/api/auth/me").json()


def test_sso_picture_becomes_the_photo_and_follows_the_provider(client, idp):
    idp.pictures["/alice.png"] = httpx.Response(200, content=PNG)
    idp.claims["picture"] = "https://cdn.test/alice.png"
    assert sso(client, idp).headers["location"] == "/"
    me = client.get("/api/auth/me").json()
    assert me["avatar_url"]
    img = client.get(me["avatar_url"])
    assert (img.content, img.headers["content-type"]) == (PNG, "image/png")

    # The same picture keeps its version: browsers keep their copy.
    assert sso_again(client, idp)["avatar_url"] == me["avatar_url"]

    # Changed at the provider: refreshed at the next sign-in.
    idp.pictures["/alice.png"] = httpx.Response(200, content=JPEG)
    me2 = sso_again(client, idp)
    assert me2["avatar_url"] != me["avatar_url"]
    assert client.get(me2["avatar_url"]).headers["content-type"] == "image/jpeg"


def test_sso_picture_does_not_replace_an_uploaded_photo(client, idp):
    idp.pictures["/alice.png"] = httpx.Response(200, content=PNG)
    idp.claims["picture"] = "https://cdn.test/alice.png"
    sso(client, idp)
    r = client.put("/api/me/avatar", files={"file": ("me.jpg", JPEG, "image/jpeg")})
    assert r.status_code == 200
    me = sso_again(client, idp)
    assert me["avatar_url"] == r.json()["avatar_url"]
    assert client.get(me["avatar_url"]).content == JPEG


def test_sso_picture_from_userinfo_as_a_data_uri(client, idp):
    idp.claims = {"sub": "u-6", "email": "dana@example.com"}
    idp.userinfo = {"picture": f"data:image/png;base64,{base64.b64encode(PNG).decode()}"}
    assert sso(client, idp).headers["location"] == "/"
    me = client.get("/api/auth/me").json()
    assert client.get(me["avatar_url"]).content == PNG


def test_a_bad_sso_picture_never_blocks_sign_in(app, client, idp):
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"/>'
    idp.pictures = {
        "/big.png": httpx.Response(200, content=b"\x89PNG\r\n\x1a\n" + b"\x00" * MAX_BYTES),
        "/avatar.svg": httpx.Response(200, content=svg, headers={"content-type": "image/png"}),
        "/error.png": httpx.Response(500),
        "/to-http.png": httpx.Response(302, headers={"location": "http://cdn.test/a.png"}),
        "/a.png": httpx.Response(200, content=PNG),
    }
    for picture in (
        "https://cdn.test/big.png",
        "https://cdn.test/avatar.svg",
        "https://cdn.test/error.png",
        "https://cdn.test/missing.png",
        "https://cdn.test/to-http.png",
        "http://cdn.test/a.png",
        "ftp://cdn.test/a.png",
        f"data:image/svg+xml;base64,{base64.b64encode(svg).decode()}",
        "data:image/png;base64,not base64!",
        "data:image/png,rawbytes",
        "not a url",
    ):
        idp.claims["picture"] = picture
        assert sso_again(client, idp)["avatar_url"] is None, picture

    # The picture's server is down.
    def cdn_down(request: httpx.Request) -> httpx.Response:
        if request.url.host == "cdn.test":
            raise httpx.ConnectError("connection refused")
        return idp.handler(request)

    app.state.ctx.extras["oidc"].transport = httpx.MockTransport(cdn_down)
    idp.claims["picture"] = "https://cdn.test/a.png"
    assert sso_again(client, idp)["avatar_url"] is None


def test_userinfo_failure_only_costs_the_picture(app, client, idp):
    def no_userinfo(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/userinfo/"):
            raise httpx.ConnectError("connection refused")
        return idp.handler(request)

    app.state.ctx.extras["oidc"].transport = httpx.MockTransport(no_userinfo)
    assert sso(client, idp).headers["location"] == "/"
    assert client.get("/api/auth/me").json()["avatar_url"] is None
