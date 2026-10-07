"""The single ingest pipeline every provider feeds positions into."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import replace
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.context import AppContext
from app.models import Device, Location, User
from app.providers.base import LocationFix
from app.schemas import LocationOut
from app.services import battery, sources
from app.services import zones as zones_service
from app.services.devices import battery_out, fix_out

MAX_FUTURE = timedelta(minutes=5)
MAX_LIVE_AGE = timedelta(days=7)
LIVE_SOURCES = {"browser", "owntracks"}


def _normalize(fixes: Sequence[LocationFix], source: str, now: datetime) -> list[LocationFix]:
    out: list[LocationFix] = []
    for f in fixes:
        if f.ts > now + MAX_FUTURE:
            f = replace(f, ts=now)
        if source in LIVE_SOURCES and f.ts < now - MAX_LIVE_AGE:
            continue
        out.append(f)
    out.sort(key=lambda f: f.ts)
    return out


async def ingest(
    ctx: AppContext,
    db: AsyncSession,
    device: Device,
    fixes: Sequence[LocationFix],
    *,
    source: str,
    battery_level: float | None = None,
    battery_charging: bool | None = None,
    region_event: bool = False,
) -> int:
    """Store fixes, update the device's latest position, evaluate zones and fan out updates.

    `region_event`: the device's own geofencing saw it cross a boundary (OwnTracks), so one
    fix is enough to confirm an arrival or departure, as with sparse providers."""
    now = utcnow()
    accepted = _normalize(fixes, source, now)
    battery_before = device.battery_level

    if accepted:
        rows = [
            {
                "device_id": device.id,
                "ts": f.ts,
                "lat": f.lat,
                "lon": f.lon,
                "accuracy": f.accuracy_m,
                "altitude": f.altitude_m,
                "speed": f.speed_mps,
                "heading": f.heading_deg,
                "battery_level": f.battery_level,
                "source": source,
                "received_at": now,
            }
            for f in accepted
        ]
        stmt = sqlite_insert(Location).on_conflict_do_nothing(index_elements=["device_id", "ts"])
        await db.execute(stmt, rows)

    newer = [f for f in accepted if device.last_fix_at is None or f.ts > device.last_fix_at]
    if newer:
        latest = newer[-1]
        device.last_lat = latest.lat
        device.last_lon = latest.lon
        device.last_accuracy = latest.accuracy_m
        device.last_fix_at = latest.ts
        if latest.battery_level is not None:
            device.battery_level = latest.battery_level
        if latest.battery_charging is not None:
            device.battery_charging = latest.battery_charging
        if latest.battery_label is not None:
            device.battery_label = latest.battery_label
    if battery_level is not None:
        device.battery_level = battery_level
    if battery_charging is not None:
        device.battery_charging = battery_charging
    device.last_seen_at = now

    zone_hits = await zones_service.evaluate(
        ctx, db, device, newer, sparse=region_event or ctx.providers.is_sparse(device.kind)
    )
    await db.commit()

    await publish_device_location(ctx, db, device)
    await zones_service.dispatch(ctx, db, device, zone_hits)
    await battery.check(ctx, db, device, battery_before)
    return len(accepted)


async def publish_device_location(ctx: AppContext, db: AsyncSession, device: Device) -> None:
    ctx.hub.send_to_users(
        [device.owner_id],
        "device.location",
        {
            "device_id": device.id,
            "location": fix_out(device),
            "battery": battery_out(device),
            "last_seen_at": device.last_seen_at,
        },
    )
    # The people who see the owner get the owner's location, which may come from another source.
    await sources.device_updated(ctx, db, device)


async def history(
    db: AsyncSession, device: Device, start: datetime, end: datetime, max_points: int
) -> tuple[list[LocationOut], int]:
    """Positions in [start, end], evenly downsampled to at most `max_points` (last point kept)."""
    where = (Location.device_id == device.id, Location.ts >= start, Location.ts <= end)
    total = (await db.execute(select(func.count()).where(*where))).scalar_one()
    if total == 0:
        return [], 0
    step = max(1, -(-total // max_points))  # ceil
    rn = func.row_number().over(order_by=Location.ts).label("rn")
    sub = select(Location.id, rn).where(*where).subquery()
    keep = select(sub.c.id).where(((sub.c.rn - 1) % step == 0) | (sub.c.rn == total))
    rows = (
        (await db.execute(select(Location).where(Location.id.in_(keep)).order_by(Location.ts)))
        .scalars()
        .all()
    )
    return [LocationOut.model_validate(r) for r in rows], total


async def purge_old(db: AsyncSession, retention_days: int) -> int:
    from sqlalchemy import delete

    cutoff = utcnow() - timedelta(days=retention_days)
    res = await db.execute(delete(Location).where(Location.ts < cutoff))
    await db.commit()
    return res.rowcount or 0


async def owner_of(db: AsyncSession, device: Device) -> User:
    owner = await db.get(User, device.owner_id)
    assert owner is not None
    return owner
