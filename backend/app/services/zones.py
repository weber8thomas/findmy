from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access
from app.clock import utcnow
from app.context import AppContext
from app.models import Device, User, Zone, ZoneEvent, ZoneState
from app.providers.base import LocationFix
from app.schemas import ZoneEventOut
from app.services import geofence
from app.services.notify import notify


@dataclass
class ZoneHit:
    zone: Zone
    event: ZoneEvent


async def zones_watching(db: AsyncSession, device: Device) -> list[Zone]:
    """Zones that apply to this device: the owner's, plus those of people who can see it."""
    owner_ids = {device.owner_id}
    _, recipients = await access.device_viewers(db, device)
    owner_ids.update(recipients)
    zones = (await db.execute(select(Zone).where(Zone.owner_id.in_(owner_ids)))).scalars().all()
    return [z for z in zones if z.device_ids is None or device.id in z.device_ids]


async def seed_states(ctx: AppContext, db: AsyncSession, zone: Zone, owner: User) -> None:
    """Establish each device's inside/outside baseline from its last known position, so the
    first movement after a zone is created (or moved) already triggers an alert."""
    ids = (
        set(zone.device_ids) if zone.device_ids is not None else await visible_device_ids(db, owner)
    )
    if not ids:
        return
    devices = (await db.execute(select(Device).where(Device.id.in_(ids)))).scalars().all()
    circle = geofence.Circle(zone.lat, zone.lon, zone.radius_m)
    for d in devices:
        if d.last_lat is None or d.last_lon is None:
            continue
        if d.last_accuracy is not None and d.last_accuracy > ctx.settings.zone_max_accuracy_m:
            continue
        side = geofence.classify(circle, d.last_lat, d.last_lon, d.last_accuracy)
        if side is None:
            continue
        row = await db.get(ZoneState, (zone.id, d.id))
        if row is None:
            db.add(ZoneState(zone_id=zone.id, device_id=d.id, state=side, pending_count=0))
        else:
            row.state, row.pending_state, row.pending_count = side, None, 0
    await db.commit()


async def evaluate(
    ctx: AppContext,
    db: AsyncSession,
    device: Device,
    fixes: Sequence[LocationFix],
    *,
    sparse: bool,
) -> list[ZoneHit]:
    if not fixes:
        return []
    hits: list[ZoneHit] = []
    s = ctx.settings
    for zone in await zones_watching(db, device):
        row = await db.get(ZoneState, (zone.id, device.id))
        if row is None:
            row = ZoneState(zone_id=zone.id, device_id=device.id, state="unknown", pending_count=0)
            db.add(row)
        st = geofence.GeoState(row.state, row.pending_state, row.pending_count or 0)  # type: ignore[arg-type]
        circle = geofence.Circle(zone.lat, zone.lon, zone.radius_m)
        for f in fixes:
            st, ev = geofence.step(
                st,
                circle,
                f.lat,
                f.lon,
                f.accuracy_m,
                confirm_fixes=s.zone_confirm_fixes,
                sparse=sparse,
                max_accuracy_m=s.zone_max_accuracy_m,
            )
            if ev:
                event = ZoneEvent(
                    zone_id=zone.id, device_id=device.id, type=ev, ts=f.ts, lat=f.lat, lon=f.lon
                )
                db.add(event)
                hits.append(ZoneHit(zone, event))
        if row.state != st.state:
            row.changed_at = utcnow()
        row.state, row.pending_state, row.pending_count = (
            st.state,
            st.pending_state,
            st.pending_count,
        )
    return hits


async def dispatch(
    ctx: AppContext, db: AsyncSession, device: Device, hits: Sequence[ZoneHit]
) -> None:
    if not hits:
        return
    owner = await db.get(User, device.owner_id)
    for hit in hits:
        zone, event = hit.zone, hit.event
        # People see a person's name, the owner sees the device name.
        who = (
            device.name
            if zone.owner_id == device.owner_id
            else (owner.display_name if owner else "?")
        )
        out = ZoneEventOut(
            id=event.id,
            zone_id=zone.id,
            zone_name=zone.name,
            device_id=device.id,
            device_name=who,
            type=event.type,
            ts=event.ts,
            lat=event.lat,
            lon=event.lon,
        )
        ctx.hub.send_to_users([zone.owner_id], "zone.event", out)
        wants = zone.notify_enter if event.type == "enter" else zone.notify_exit
        if wants:
            await notify(
                ctx,
                db,
                zone.owner_id,
                f"zone_{event.type}",
                {"who": who, "zone": zone.name, "zone_id": zone.id, "device_id": device.id},
                url="/me/zones",
            )


async def list_events(db: AsyncSession, user: User, limit: int) -> list[ZoneEventOut]:
    rows = (
        await db.execute(
            select(ZoneEvent, Zone, Device)
            .join(Zone, Zone.id == ZoneEvent.zone_id)
            .join(Device, Device.id == ZoneEvent.device_id)
            .where(Zone.owner_id == user.id)
            .order_by(ZoneEvent.ts.desc())
            .limit(limit)
        )
    ).all()
    out = []
    for ev, zone, dev in rows:
        out.append(
            ZoneEventOut(
                id=ev.id,
                zone_id=zone.id,
                zone_name=zone.name,
                device_id=dev.id,
                device_name=dev.name,
                type=ev.type,
                ts=ev.ts,
                lat=ev.lat,
                lon=ev.lon,
            )
        )
    return out


async def visible_device_ids(db: AsyncSession, user: User) -> set[str]:
    own = (await db.execute(select(Device.id).where(Device.owner_id == user.id))).scalars().all()
    owners = await access.owner_ids_sharing_with(db, user.id)
    shared: list[str] = []
    if owners:
        shared = list(
            (
                await db.execute(
                    select(User.primary_device_id).where(
                        User.id.in_(owners), or_(User.primary_device_id.is_not(None))
                    )
                )
            )
            .scalars()
            .all()
        )
    return set(own) | {d for d in shared if d}
