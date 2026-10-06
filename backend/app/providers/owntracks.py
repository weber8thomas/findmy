"""OwnTracks HTTP mode: lets the native OwnTracks app report in the background.

Configure the app with Mode = HTTP, URL = https://<host>/api/owntracks,
username = your account email, password = the device token.
"""

from __future__ import annotations

import base64
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Request, status

from app.deps import DB, Ctx, device_from_token, rate_limit
from app.models import DeviceKind, User
from app.providers.base import LocationFix, Provider
from app.services import locations


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


def parse_location(msg: dict) -> tuple[LocationFix, float | None, bool | None] | None:
    if msg.get("_type") != "location":
        return None
    try:
        lat, lon, tst = float(msg["lat"]), float(msg["lon"]), int(msg["tst"])
    except (KeyError, TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None
    vel = msg.get("vel")
    batt = msg.get("batt")
    level = max(0.0, min(1.0, float(batt) / 100)) if isinstance(batt, int | float) else None
    bs = msg.get("bs")
    charging = {1: False, 2: True, 3: True}.get(bs) if isinstance(bs, int) else None
    fix = LocationFix(
        ts=datetime.fromtimestamp(tst, UTC),
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
    return []


class OwnTracksProvider(Provider):
    kind = DeviceKind.OWNTRACKS

    def routers(self) -> list[APIRouter]:
        return [router]
