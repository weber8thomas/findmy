"""Pure geofence logic (no I/O), with hysteresis so GPS jitter at the edge doesn't spam alerts."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

Side = Literal["inside", "outside"]
StateName = Literal["unknown", "inside", "outside"]
EventType = Literal["enter", "exit"]

EARTH_RADIUS_M = 6_371_008.8


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


@dataclass(frozen=True)
class Circle:
    lat: float
    lon: float
    radius_m: float


@dataclass(frozen=True)
class GeoState:
    state: StateName = "unknown"
    pending_state: Side | None = None
    pending_count: int = 0


def margin_m(radius_m: float) -> float:
    return max(25.0, 0.1 * radius_m)


def classify(zone: Circle, lat: float, lon: float, accuracy_m: float | None) -> Side | None:
    """'inside' / 'outside' when the fix is clearly on one side, None in the hysteresis band."""
    d = haversine_m(zone.lat, zone.lon, lat, lon)
    a = min(accuracy_m or 0.0, zone.radius_m)
    if d + a / 2 <= zone.radius_m:
        return "inside"
    if d - a / 2 >= zone.radius_m + margin_m(zone.radius_m):
        return "outside"
    return None


def step(
    state: GeoState,
    zone: Circle,
    lat: float,
    lon: float,
    accuracy_m: float | None,
    *,
    confirm_fixes: int = 2,
    sparse: bool = False,
    max_accuracy_m: float = 250.0,
) -> tuple[GeoState, EventType | None]:
    """Advance the state machine by one fix. Returns (new state, event or None)."""
    if accuracy_m is not None and accuracy_m > max_accuracy_m:
        return state, None
    side = classify(zone, lat, lon, accuracy_m)
    if side is None:
        return GeoState(state.state), None
    if state.state == "unknown":
        # First observation: establish the baseline silently (no alert when a zone is created).
        return GeoState(side), None
    if side == state.state:
        return GeoState(state.state), None
    count = state.pending_count + 1 if state.pending_state == side else 1
    needed = 1 if sparse else max(1, confirm_fixes)
    if count >= needed:
        return GeoState(side), ("enter" if side == "inside" else "exit")
    return GeoState(state.state, side, count), None
