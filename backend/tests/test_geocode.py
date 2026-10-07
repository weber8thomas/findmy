from __future__ import annotations

import asyncio
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from app import version
from app.main import create_app
from app.services import geocode
from app.services.geocode import USER_AGENT, GeocodeError, Geocoder

ADDRESS = "Stephansplatz 1, Wien"

# What nominatim.openstreetmap.org answers (format=jsonv2), trimmed.
WIEN = [
    {
        "place_id": 100000001,
        "lat": "48.2084263",
        "lon": "16.3731453",
        "category": "place",
        "type": "house",
        "name": "",
        "display_name": "1, Stephansplatz, Innere Stadt, Wien, "
        "1010, Österreich",
    },
    {
        "place_id": 100000002,
        "lat": "48.2090",
        "lon": "16.3727",
        "category": "highway",
        "type": "residential",
        "name": "Stephansplatz",
        "display_name": "Stephansplatz, Innere Stadt, Wien, "
        "1010, Österreich",
    },
]


class FakeNominatim:
    """A Nominatim /search endpoint that records what it was asked."""

    def __init__(self) -> None:
        self.requests: list[httpx.Request] = []
        self.answer: httpx.Response | Exception = httpx.Response(200, json=WIEN)

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if isinstance(self.answer, Exception):
            raise self.answer
        return self.answer


@pytest.fixture
def nominatim(app) -> FakeNominatim:
    fake = FakeNominatim()
    geocoder = app.state.ctx.extras["geocoder"]
    geocoder.transport = httpx.MockTransport(fake.handler)
    geocoder.min_interval_s = 0  # the spacing has its own test
    return fake


def test_results_mapped_and_asked_in_the_users_language(api, nominatim):
    user = api.register("Camille", locale="fr")
    r = api.c.get("/api/geocode", params={"q": f"  {ADDRESS} "}, headers=api.h(user))
    assert r.status_code == 200, r.text
    assert r.json() == [
        {
            "label": "1, Stephansplatz, Innere Stadt, Wien, "
            "1010, Österreich",
            "lat": 48.2084263,
            "lon": 16.3731453,
        },
        {
            "label": "Stephansplatz, Innere Stadt, Wien, "
            "1010, Österreich",
            "lat": 48.209,
            "lon": 16.3727,
        },
    ]
    [sent] = nominatim.requests
    assert sent.url.host == "nominatim.openstreetmap.org"
    assert sent.url.path == "/search"
    assert dict(sent.url.params) == {
        "q": ADDRESS,
        "format": "jsonv2",
        "limit": "5",
        "accept-language": "fr",
    }
    # The app names itself; only the typed text leaves the server, not the user's address.
    assert sent.headers["user-agent"] == USER_AGENT
    assert USER_AGENT.startswith(f"Oukile/{version.VERSION} (self-hosted family app")
    assert not any(h in sent.headers for h in ("x-forwarded-for", "forwarded", "cookie"))


def test_at_most_five_places_and_unusable_entries_skipped(api, nominatim):
    good = [
        {"lat": str(48 + i / 100), "lon": "16.4", "display_name": f"Place {i}"} for i in range(7)
    ]
    nominatim.answer = httpx.Response(
        200,
        json=[
            {"lat": "nope", "lon": "16.4", "display_name": "No latitude"},
            {"lat": "48.2", "lon": "16.4", "display_name": " "},
            {"lat": "95", "lon": "16.4", "display_name": "Off the globe"},
            "not an object",
            *good,
        ],
    )
    user = api.register()
    r = api.c.get("/api/geocode", params={"q": "Place"}, headers=api.h(user))
    assert r.status_code == 200
    assert [p["label"] for p in r.json()] == [f"Place {i}" for i in range(5)]


def test_no_results(api, nominatim):
    nominatim.answer = httpx.Response(200, json=[])
    user = api.register()
    r = api.c.get("/api/geocode", params={"q": "zzzz qqqq"}, headers=api.h(user))
    assert r.status_code == 200
    assert r.json() == []


def test_signed_in_users_only(api, nominatim):
    assert api.c.get("/api/geocode", params={"q": ADDRESS}).status_code == 401
    device = api.device(api.register())
    r = api.c.get(
        "/api/geocode",
        params={"q": ADDRESS},
        headers={"Authorization": f"Bearer {device['token']}"},
    )
    assert r.status_code == 401
    assert nominatim.requests == []


def test_query_checked(api, nominatim):
    user = api.register()
    for params in ({}, {"q": ""}, {"q": "   "}, {"q": "a"}, {"q": "x" * 201}):
        assert api.c.get("/api/geocode", params=params, headers=api.h(user)).status_code == 422
    assert nominatim.requests == []


def test_config_announces_address_search(client):
    cfg = client.get("/api/config").json()
    assert cfg["features"]["geocode"] is True
    assert cfg["geocoder_host"] == "nominatim.openstreetmap.org"


def test_turned_off_with_an_empty_setting(settings, fake_push):
    settings.geocoder_url = ""
    app = create_app(settings)
    assert "geocoder" not in app.state.ctx.extras
    with TestClient(app) as c:
        cfg = c.get("/api/config").json()
        assert cfg["features"]["geocode"] is False
        assert cfg["geocoder_host"] is None
        r = c.post(
            "/api/auth/register?bearer=1",
            json={"email": "off@example.com", "password": "correct horse", "display_name": "Off"},
        )
        token = r.json()["token"]
        c.cookies.clear()
        r = c.get(
            "/api/geocode", params={"q": ADDRESS}, headers={"Authorization": f"Bearer {token}"}
        )
        assert r.status_code == 404


def test_own_nominatim_server(settings, fake_push):
    settings.geocoder_url = "http://nominatim.lan:8080/"
    app = create_app(settings)
    fake = FakeNominatim()
    app.state.ctx.extras["geocoder"].transport = httpx.MockTransport(fake.handler)
    with TestClient(app) as c:
        assert c.get("/api/config").json()["geocoder_host"] == "nominatim.lan:8080"
        r = c.post(
            "/api/auth/register?bearer=1",
            json={"email": "lan@example.com", "password": "correct horse", "display_name": "Lan"},
        )
        headers = {"Authorization": f"Bearer {r.json()['token']}"}
        c.cookies.clear()
        assert c.get("/api/geocode", params={"q": ADDRESS}, headers=headers).status_code == 200
    assert str(fake.requests[0].url).startswith("http://nominatim.lan:8080/search?")


def test_answers_cached(api, nominatim):
    camille = api.register("Camille", locale="fr")
    claire = api.register("Claire", locale="fr")
    alex = api.register("Alex", locale="en")
    for user, q in (
        (camille, ADDRESS),
        (camille, ADDRESS.upper()),
        (claire, ADDRESS.replace(" ", "  ")),
    ):
        r = api.c.get("/api/geocode", params={"q": q}, headers=api.h(user))
        assert r.status_code == 200
        assert len(r.json()) == 2
    assert len(nominatim.requests) == 1
    # Another language is another answer (place names are translated).
    api.c.get("/api/geocode", params={"q": ADDRESS}, headers=api.h(alex))
    assert len(nominatim.requests) == 2
    assert nominatim.requests[1].url.params["accept-language"] == "en"


@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(500, text="Internal Server Error"),
        httpx.Response(429, text="Too Many Requests"),
        httpx.Response(403, text="Access blocked"),
        httpx.Response(200, text="<html>maintenance</html>"),
        httpx.Response(200, json={"error": "Unable to geocode"}),
        httpx.ConnectError("unreachable"),
        httpx.ReadTimeout("too slow"),
    ],
    ids=["500", "429", "403", "html", "not-a-list", "unreachable", "timeout"],
)
def test_upstream_failure_is_a_502(api, nominatim, answer):
    nominatim.answer = answer
    user = api.register()
    r = api.c.get("/api/geocode", params={"q": ADDRESS}, headers=api.h(user))
    assert r.status_code == 502
    assert r.json() == {"detail": "address search unavailable"}
    # Failures are not cached: the next search asks again.
    nominatim.answer = httpx.Response(200, json=WIEN)
    r = api.c.get("/api/geocode", params={"q": ADDRESS}, headers=api.h(user))
    assert r.status_code == 200
    assert len(nominatim.requests) == 2


def test_rate_limited_per_user(settings, fake_push):
    settings.rate_limit_enabled = True
    app = create_app(settings)
    fake = FakeNominatim()
    app.state.ctx.extras["geocoder"].transport = httpx.MockTransport(fake.handler)
    with TestClient(app) as c:
        tokens = []
        for name in ("a", "b"):
            r = c.post(
                "/api/auth/register?bearer=1",
                json={
                    "email": f"{name}@example.com",
                    "password": "correct horse",
                    "display_name": name,
                },
            )
            tokens.append(r.json()["token"])
            c.cookies.clear()
        first, second = ({"Authorization": f"Bearer {t}"} for t in tokens)
        codes = [
            c.get("/api/geocode", params={"q": ADDRESS}, headers=first).status_code
            for _ in range(11)
        ]
        assert codes == [200] * 10 + [429]
        assert c.get("/api/geocode", params={"q": ADDRESS}, headers=second).status_code == 200


def test_one_request_at_a_time_at_most_one_per_interval():
    """Concurrent searches reach the geocoder one after the other, spaced by the interval."""
    spans: list[tuple[float, float]] = []

    async def slow(request: httpx.Request) -> httpx.Response:
        start = time.monotonic()
        await asyncio.sleep(0.05)
        spans.append((start, time.monotonic()))
        return httpx.Response(200, json=WIEN)

    async def run() -> list[list[geocode.Place]]:
        geocoder = Geocoder("https://nominatim.test", httpx.MockTransport(slow))
        geocoder.min_interval_s = 0.2
        # Three addresses, and one asked twice at once: answered once.
        queries = ["a street", "b street", "c street", "a street"]
        return await asyncio.gather(*(geocoder.search(q, "fr") for q in queries))

    results = asyncio.run(run())
    assert all(len(r) == 2 for r in results)
    assert len(spans) == 3
    spans.sort()
    for (_, end), (start, _) in zip(spans, spans[1:], strict=False):
        assert start - end >= 0.19


def test_cache_is_a_small_lru(monkeypatch):
    monkeypatch.setattr(geocode, "CACHE_SIZE", 2)
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.params["q"])
        return httpx.Response(200, json=WIEN)

    async def run() -> None:
        geocoder = Geocoder("https://nominatim.test", httpx.MockTransport(handler))
        geocoder.min_interval_s = 0
        for q in ("one", "two", "one", "three", "one", "two"):
            await geocoder.search(q, "en")

    asyncio.run(run())
    # "two" was the least recently used when "three" came in.
    assert asked == ["one", "two", "three", "two"]


def test_cache_expires(monkeypatch):
    monkeypatch.setattr(geocode, "CACHE_TTL_S", -1)
    asked: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        asked.append(request.url.params["q"])
        return httpx.Response(200, json=[])

    async def run() -> None:
        geocoder = Geocoder("https://nominatim.test", httpx.MockTransport(handler))
        geocoder.min_interval_s = 0
        assert await geocoder.search("gone", "en") == []
        assert await geocoder.search("gone", "en") == []

    asyncio.run(run())
    assert asked == ["gone", "gone"]


def test_geocode_error_from_the_service():
    async def run() -> None:
        geocoder = Geocoder(
            "https://nominatim.test", httpx.MockTransport(lambda r: httpx.Response(503))
        )
        with pytest.raises(GeocodeError, match="HTTP 503"):
            await geocoder.search("anything", "en")

    asyncio.run(run())
