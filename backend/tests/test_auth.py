from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


def test_health_and_config(client):
    assert client.get("/api/health").json() == {"status": "ok"}
    cfg = client.get("/api/config").json()
    assert cfg["features"]["findmy"] is False
    assert cfg["features"]["icloud"] is False
    assert "browser" in cfg["providers"]
    assert cfg["vapid_public_key"]


def test_register_login_me_logout(client):
    r = client.post(
        "/api/auth/register",
        json={"email": "Ann@Example.com", "password": "secret123", "display_name": "Ann"},
    )
    assert r.status_code == 201
    assert r.json()["token"] is None  # cookie only by default
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie.replace("Lax", "lax")
    me = client.get("/api/auth/me").json()
    assert me["email"] == "ann@example.com"
    assert me["is_admin"] is True

    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401

    r = client.post("/api/auth/login", json={"email": "ann@example.com", "password": "nope"})
    assert r.status_code == 401
    r = client.post("/api/auth/login", json={"email": "ann@example.com", "password": "secret123"})
    assert r.status_code == 200
    assert client.get("/api/auth/me").status_code == 200


def test_duplicate_email(client):
    body = {"email": "dup@example.com", "password": "secret123", "display_name": "D"}
    assert client.post("/api/auth/register", json=body).status_code == 201
    assert client.post("/api/auth/register", json=body).status_code == 409


def test_second_user_not_admin(api, client):
    api.register("A")
    b = api.register("B")
    assert client.get("/api/auth/me", headers=api.h(b)).json()["is_admin"] is False


def test_cross_origin_cookie_post_rejected(client):
    client.post(
        "/api/auth/register",
        json={"email": "o@example.com", "password": "secret123", "display_name": "O"},
    )
    r = client.post("/api/devices", json={"name": "x"}, headers={"Origin": "https://evil.example"})
    assert r.status_code == 403
    r = client.post("/api/devices", json={"name": "x"}, headers={"Origin": "http://testserver"})
    assert r.status_code == 201


def test_registration_can_be_closed(tmp_path):
    s = Settings(data_dir=tmp_path, allow_registration=False, _env_file=None)
    with TestClient(create_app(s)) as c:
        body = {"email": "first@example.com", "password": "secret123", "display_name": "F"}
        assert c.post("/api/auth/register", json=body).status_code == 201  # first user allowed
        body["email"] = "second@example.com"
        assert c.post("/api/auth/register", json=body).status_code == 403


def test_login_rate_limited(tmp_path):
    s = Settings(data_dir=tmp_path, rate_limit_enabled=True, _env_file=None)
    with TestClient(create_app(s)) as c:
        codes = [
            c.post("/api/auth/login", json={"email": "x@example.com", "password": "p"}).status_code
            for _ in range(12)
        ]
        assert codes[0] == 401
        assert 429 in codes


def test_update_me_locale(api, client):
    a = api.register("A")
    r = client.patch("/api/me", json={"locale": "fr", "display_name": "Alice"}, headers=api.h(a))
    assert r.status_code == 200
    assert r.json()["locale"] == "fr"
    assert client.patch("/api/me", json={"locale": "de"}, headers=api.h(a)).status_code == 422


def test_sso_off_by_default(client):
    assert client.get("/api/config").json()["auth"] == {"password": True, "oidc": None}
    r = client.get("/api/auth/oidc/login", follow_redirects=False)
    assert r.status_code == 303
    assert r.headers["location"] == "/login?sso_error=disabled"


def test_client_ip_behind_proxy(settings):
    from starlette.requests import Request

    from app.deps import client_ip

    def ip(trust: bool, fwd: str | None) -> str:
        headers = [(b"x-forwarded-for", fwd.encode())] if fwd else []
        scope = {"type": "http", "headers": headers, "client": ("192.0.2.10", 5000)}
        settings.trust_proxy = trust
        return client_ip(Request(scope), SimpleNamespace(settings=settings))

    assert ip(False, "1.2.3.4") == "192.0.2.10"
    assert ip(True, None) == "192.0.2.10"
    # A client-supplied entry comes first; the proxy appends the real address.
    assert ip(True, "6.6.6.6, 203.0.113.9") == "203.0.113.9"
