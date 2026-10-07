"""OwnTracks HTTP mode: lets the native OwnTracks app report in the background.

Configure the app with Mode = HTTP, URL = https://<host>/api/owntracks,
username = your account email, password = the device token.

The JSON array returned to each POST is read by the app as incoming messages. Oukilé puts
`cmd` messages there: the owner's places as waypoints (the app's geofencing then reports
arrivals and departures right away), and, for the Android app, a reporting profile.
The app only obeys them with `cmd` and `remoteConfiguration` on (the setup link turns them on).
"""

from __future__ import annotations

import base64
import hashlib
import json
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.context import AppContext
from app.deps import DB, Ctx, device_from_token, rate_limit
from app.models import Device, DeviceKind, User, Zone
from app.providers.base import LocationFix, Provider
from app.services import geofence, locations

# Reporting profiles sent with setConfiguration, which only changes the keys it carries
# (monitoring stays Significant). Inside one of your places the phone sits still and its
# geofence reports the departure, so it can wake up rarely; outside, it reports every 100 m
# (at most once a minute) so short trips show, unlike the app's 500 m default.
CALM_PROFILE = {"locatorDisplacement": 500, "locatorInterval": 300}
REACTIVE_PROFILE = {"locatorDisplacement": 100, "locatorInterval": 60}
PROFILES = {"calm": CALM_PROFILE, "reactive": REACTIVE_PROFILE}

# Only the Android app gets a profile: on iOS these keys only apply in Move mode, where they
# would override the person's own choice. The Android app names itself in its User-Agent.
ANDROID_USER_AGENT = "Owntracks-Android/"

# What the app was last sent, in Device.provider_config. Forgotten when it is set up again.
WAYPOINTS_KEY = "waypoints_hash"
PROFILE_KEY = "profile"
PROFILE_SENT_KEY = "profile_sent_at"
SYNC_KEYS = (WAYPOINTS_KEY, PROFILE_KEY, PROFILE_SENT_KEY)

# The app never says whether it applied a profile: it ignores one sent while its remote
# configuration is off. Sent again this often, it catches up within a day; resending the same
# values changes nothing on the phone.
PROFILE_RESEND = timedelta(days=1)


def _basic_auth(request: Request) -> tuple[str, str] | None:
    header = request.headers.get("authorization", "")
    scheme, _, value = header.partition(" ")
    if scheme.lower() != "basic" or not value:
        return None
    try:
        user, _, password = base64.b64decode(value).decode().partition(":")
    except Exception:
        return None
    return user, password


def _position(msg: dict) -> tuple[float, float, datetime] | None:
    try:
        lat, lon, tst = float(msg["lat"]), float(msg["lon"]), int(msg["tst"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    return lat, lon, datetime.fromtimestamp(tst, UTC)


def parse_location(msg: dict) -> tuple[LocationFix, float | None, bool | None] | None:
    if msg.get("_type") != "location":
        return None
    pos = _position(msg)
    if pos is None:
        return None
    lat, lon, ts = pos
    vel = msg.get("vel")
    batt = msg.get("batt")
    level = max(0.0, min(1.0, float(batt) / 100)) if isinstance(batt, int | float) else None
    bs = msg.get("bs")
    charging = {1: False, 2: True, 3: True}.get(bs) if isinstance(bs, int) else None
    fix = LocationFix(
        ts=ts,
        lat=lat,
        lon=lon,
        accuracy_m=float(msg["acc"]) if isinstance(msg.get("acc"), int | float) else None,
        altitude_m=float(msg["alt"]) if isinstance(msg.get("alt"), int | float) else None,
        speed_mps=float(vel) / 3.6 if isinstance(vel, int | float) and vel >= 0 else None,
        heading_deg=float(msg["cog"]) if isinstance(msg.get("cog"), int | float) else None,
        battery_level=level,
        battery_charging=charging,
    )
    return fix, level, charging


def parse_transition(msg: dict) -> LocationFix | None:
    """Entering or leaving one of the app's waypoints: the position that triggered it."""
    if msg.get("_type") != "transition":
        return None
    pos = _position(msg)
    if pos is None:
        return None
    lat, lon, ts = pos
    acc = msg.get("acc")  # absent on iOS when the accuracy is unknown
    return LocationFix(
        ts=ts, lat=lat, lon=lon, accuracy_m=float(acc) if isinstance(acc, int | float) else None
    )


def waypoints_of(zones: list[Zone]) -> list[dict[str, Any]]:
    """The places as OwnTracks waypoints, keyed by `tst` (Android: alone, unique; iOS: with the
    name). It is the creation time, a second later for one created in the same second."""
    out: list[dict[str, Any]] = []
    last = None
    for z in sorted(zones, key=lambda z: (z.created_at, z.id)):
        tst = int(z.created_at.timestamp())
        if last is not None and tst <= last:
            tst = last + 1
        last = tst
        out.append(
            {
                "_type": "waypoint",
                "desc": z.name,
                "lat": z.lat,
                "lon": z.lon,
                "rad": round(z.radius_m),  # an integer: Android rejects the reply otherwise
                "tst": tst,
            }
        )
    return out


def _digest(waypoints: list[dict[str, Any]]) -> str:
    return hashlib.sha256(json.dumps(waypoints, sort_keys=True).encode()).hexdigest()[:16]


def forget_sync(device: Device) -> None:
    """The app is being set up again (maybe reinstalled): send it everything anew."""
    cfg = device.provider_config or {}
    if any(k in cfg for k in SYNC_KEYS):
        device.provider_config = {k: v for k, v in cfg.items() if k not in SYNC_KEYS}


def _profile(ctx: AppContext, device: Device, zones: list[Zone]) -> str | None:
    if device.last_lat is None or device.last_lon is None:
        return None
    if device.last_accuracy is not None and device.last_accuracy > ctx.settings.zone_max_accuracy_m:
        return "reactive"
    inside = any(
        geofence.haversine_m(z.lat, z.lon, device.last_lat, device.last_lon) <= z.radius_m
        for z in zones
    )
    return "calm" if inside else "reactive"


def _sent_long_ago(cfg: dict, now: datetime) -> bool:
    try:
        return now - datetime.fromisoformat(cfg[PROFILE_SENT_KEY]) >= PROFILE_RESEND
    except (KeyError, TypeError, ValueError):
        return True


async def commands_for(
    ctx: AppContext,
    db: AsyncSession,
    device: Device,
    *,
    android: bool,
    now: datetime | None = None,
) -> list[dict[str, Any]]:
    """`cmd` messages for the reply: what changed since the app was last told."""
    zones = list(
        (await db.execute(select(Zone).where(Zone.owner_id == device.owner_id))).scalars().all()
    )
    cfg = dict(device.provider_config or {})
    out: list[dict[str, Any]] = []

    waypoints = waypoints_of(zones)
    digest = _digest(waypoints)
    if cfg.get(WAYPOINTS_KEY, _digest([])) != digest:
        # setWaypoints adds and updates but never removes: start from an empty list. The app
        # handles the reply's messages in order.
        out.append({"_type": "cmd", "action": "clearWaypoints"})
        if waypoints:
            out.append(
                {
                    "_type": "cmd",
                    "action": "setWaypoints",
                    "waypoints": {"_type": "waypoints", "waypoints": waypoints},
                }
            )
        cfg[WAYPOINTS_KEY] = digest

    profile = _profile(ctx, device, zones) if android else None
    now = now or datetime.now(UTC)
    if profile is not None and (cfg.get(PROFILE_KEY) != profile or _sent_long_ago(cfg, now)):
        out.append(
            {
                "_type": "cmd",
                "action": "setConfiguration",
                "configuration": {"_type": "configuration", **PROFILES[profile]},
            }
        )
        cfg[PROFILE_KEY] = profile
        cfg[PROFILE_SENT_KEY] = now.isoformat()

    if cfg != (device.provider_config or {}):
        device.provider_config = cfg
        await db.commit()
    return out


router = APIRouter(tags=["owntracks"])


@router.post("/owntracks")
async def owntracks_endpoint(request: Request, ctx: Ctx, db: DB):
    creds = _basic_auth(request)
    if creds is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "auth required", headers={"WWW-Authenticate": "Basic"}
        )
    email, token = creds
    device = await device_from_token(token, db)
    owner = await db.get(User, device.owner_id) if device else None
    if device is None or owner is None or owner.email != email.strip().lower():
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED, "bad credentials", headers={"WWW-Authenticate": "Basic"}
        )
    if device.kind != DeviceKind.OWNTRACKS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "device is not an OwnTracks device")
    rate_limit(ctx, "report", device.id, 30, 60)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid json") from None
    messages = body if isinstance(body, list) else [body]
    fixes: list[LocationFix] = []
    transitions: list[LocationFix] = []
    level = charging = None
    for msg in messages[:500]:
        if not isinstance(msg, dict):
            continue
        parsed = parse_location(msg)
        if parsed:
            fixes.append(parsed[0])
            level, charging = parsed[1], parsed[2]
            if isinstance(msg.get("tid"), str):
                device.provider_config = {**(device.provider_config or {}), "tid": msg["tid"][:4]}
        elif (fix := parse_transition(msg)) is not None:
            transitions.append(fix)
    if transitions:
        # Before the locations: with a region event the app also sends a location of the
        # same time, and only positions newer than the last one are checked against zones.
        await locations.ingest(ctx, db, device, transitions, source="owntracks", region_event=True)
    if fixes:
        await locations.ingest(
            ctx,
            db,
            device,
            fixes,
            source="owntracks",
            battery_level=level,
            battery_charging=charging,
        )
    android = request.headers.get("user-agent", "").startswith(ANDROID_USER_AGENT)
    return await commands_for(ctx, db, device, android=android)


class OwnTracksProvider(Provider):
    kind = DeviceKind.OWNTRACKS

    def routers(self) -> list[APIRouter]:
        return [router]
