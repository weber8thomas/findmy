"""Address search, to place a zone: a proxy to an OpenStreetMap Nominatim server.

The server asks on the user's behalf, so Nominatim sees the typed text and the app's language,
never the user's IP address or account. Nominatim's usage policy
(https://operations.osmfoundation.org/policies/nominatim/) is kept here: a User-Agent naming the
app, one request at a time and at most one per second for the whole server, answers cached. The
app only searches when asked to, never as the user types.
"""

from __future__ import annotations

import asyncio
import logging
import math
import time
from collections import OrderedDict
from typing import TypedDict

import httpx

from app import version

log = logging.getLogger(__name__)

# ASCII only: HTTP header values are.
USER_AGENT = (
    f"Oukile/{version.VERSION} (self-hosted family app; +https://github.com/weber8thomas/findmy)"
)
MAX_RESULTS = 5
TIMEOUT_S = 8.0
# Nominatim's absolute maximum, for the whole server.
MIN_INTERVAL_S = 1.0
CACHE_SIZE = 256
CACHE_TTL_S = 24 * 3600


class GeocodeError(Exception):
    """The geocoder could not be reached or answered something unexpected."""


class Place(TypedDict):
    label: str
    lat: float
    lon: float


def normalize(query: str) -> str:
    """The query as sent: spaces collapsed."""
    return " ".join(query.split())


def parse_results(data: object) -> list[Place]:
    """Nominatim's `jsonv2` answer as places; entries without a usable position are skipped."""
    if not isinstance(data, list):
        raise GeocodeError("unexpected answer")
    places: list[Place] = []
    for item in data:
        if not isinstance(item, dict):
            continue
        label = item.get("display_name")
        try:
            lat, lon = float(item["lat"]), float(item["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        if not isinstance(label, str) or not label.strip():
            continue
        if not (math.isfinite(lat) and math.isfinite(lon)):
            continue
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            continue
        places.append(Place(label=label.strip(), lat=lat, lon=lon))
        if len(places) == MAX_RESULTS:
            break
    return places


class Geocoder:
    def __init__(self, base_url: str, transport: httpx.AsyncBaseTransport | None = None):
        self.base_url = base_url.strip().rstrip("/")
        self.transport = transport  # tests
        self.min_interval_s = MIN_INTERVAL_S
        self._lock = asyncio.Lock()
        self._last_request = -math.inf
        self._cache: OrderedDict[tuple[str, str], tuple[float, list[Place]]] = OrderedDict()

    def _cached(self, key: tuple[str, str]) -> list[Place] | None:
        hit = self._cache.get(key)
        if hit is None:
            return None
        stored_at, places = hit
        if time.monotonic() - stored_at > CACHE_TTL_S:
            del self._cache[key]
            return None
        self._cache.move_to_end(key)
        return places

    def _store(self, key: tuple[str, str], places: list[Place]) -> None:
        self._cache[key] = (time.monotonic(), places)
        self._cache.move_to_end(key)
        while len(self._cache) > CACHE_SIZE:
            self._cache.popitem(last=False)

    async def search(self, query: str, lang: str) -> list[Place]:
        """Up to five places for an address, in the user's language. Raises GeocodeError."""
        query = normalize(query)
        key = (query.casefold(), lang)
        if (hit := self._cached(key)) is not None:
            return hit
        # One request at a time, spaced by min_interval_s from the end of the previous one.
        async with self._lock:
            # Asked meanwhile by someone else: answered from the cache.
            if (hit := self._cached(key)) is not None:
                return hit
            wait = self._last_request + self.min_interval_s - time.monotonic()
            if wait > 0:
                await asyncio.sleep(wait)
            try:
                places = await self._fetch(query, lang)
            finally:
                self._last_request = time.monotonic()
            self._store(key, places)
        return places

    async def _fetch(self, query: str, lang: str) -> list[Place]:
        params = {
            "q": query,
            "format": "jsonv2",
            "limit": str(MAX_RESULTS),
            "accept-language": lang,
        }
        headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
        try:
            async with (
                asyncio.timeout(TIMEOUT_S),
                httpx.AsyncClient(timeout=TIMEOUT_S, transport=self.transport) as http,
            ):
                r = await http.get(f"{self.base_url}/search", params=params, headers=headers)
        except (httpx.HTTPError, TimeoutError) as e:
            log.warning("address search: %s", type(e).__name__)
            raise GeocodeError(type(e).__name__) from e
        if r.status_code != 200:
            log.warning("address search: HTTP %s", r.status_code)
            raise GeocodeError(f"HTTP {r.status_code}")
        try:
            data = r.json()
        except ValueError as e:
            raise GeocodeError("answer is not JSON") from e
        return parse_results(data)
