from __future__ import annotations

import base64
import hashlib
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

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

    def handler(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
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
