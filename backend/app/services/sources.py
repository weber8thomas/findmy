"""Where a person is: one of their own devices, picked from an ordered list of sources.

The first source whose position is fresh wins (a phone in the pocket), otherwise the most
recent position of any of them (the tag left in the wallet). Without a saved list, the primary
device alone is the source, as before sources existed. The primary device stays the first
source: zone alerts and access rules go by it.

The people I share with get the position and the name of the device it comes from, never the
list of my devices.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access
from app.clock import utcnow
from app.context import AppContext
from app.models import Device, LocationSource, User
from app.schemas import MAX_SOURCES, FixOut, MyLocationOut
from app.services.devices import fix_out

# A source updated within this is still where the person is.
FRESH = timedelta(minutes=30)
# Last result pushed per user, so a source that updates without changing it stays quiet.
_PUSHED = "person_locations"


@dataclass(frozen=True)
class Resolved:
    device: Device
    fix: FixOut


def pick(devices: Sequence[Device], now: datetime) -> Resolved | None:
    """The first device (in priority order) with a fresh position, else the latest position."""
    located = [Resolved(d, f) for d in devices if (f := fix_out(d)) is not None]
    for r in located:
        if now - r.fix.ts <= FRESH:
            return r
    # max() keeps the first of equals: the higher priority on a tie.
    return max(located, key=lambda r: r.fix.ts, default=None)


async def saved_ids(db: AsyncSession, user_id: str) -> list[str]:
    rows = await db.execute(
        select(LocationSource.device_id)
        .where(LocationSource.user_id == user_id)
        .order_by(LocationSource.rank)
    )
    return list(rows.scalars())


async def source_ids(db: AsyncSession, user: User) -> list[str]:
    """My sources in priority order: the saved list, or the primary device alone."""
    ids = await saved_ids(db, user.id)
    if ids:
        return ids
    return [user.primary_device_id] if user.primary_device_id else []


async def resolve(db: AsyncSession, user: User) -> Resolved | None:
    ids = await source_ids(db, user)
    if not ids:
        return None
    rows = await db.execute(select(Device).where(Device.id.in_(ids), Device.owner_id == user.id))
    by_id = {d.id: d for d in rows.scalars()}
    return pick([by_id[i] for i in ids if i in by_id], utcnow())


def my_location_out(resolved: Resolved | None) -> MyLocationOut:
    if resolved is None:
        return MyLocationOut(location=None, device_id=None, device_name=None)
    return MyLocationOut(
        location=resolved.fix, device_id=resolved.device.id, device_name=resolved.device.name
    )


async def save(db: AsyncSession, user: User, device_ids: Sequence[str]) -> None:
    """Replace my sources (not committed); each must be one of my devices (404 otherwise).
    An empty list goes back to the primary device alone."""
    for device_id in device_ids:
        await access.get_owned_device(db, user, device_id)
    await db.execute(delete(LocationSource).where(LocationSource.user_id == user.id))
    db.add_all(
        LocationSource(user_id=user.id, device_id=device_id, rank=rank)
        for rank, device_id in enumerate(device_ids)
    )
    if device_ids:
        user.primary_device_id = device_ids[0]


async def set_primary(db: AsyncSession, user: User, device_id: str | None) -> None:
    """Make a device the primary one (not committed): with a saved list, it moves to the top."""
    ids = await saved_ids(db, user.id)
    if ids and device_id is not None:
        await save(db, user, [device_id, *(i for i in ids if i != device_id)][:MAX_SOURCES])
    elif ids:
        await save(db, user, [])
    user.primary_device_id = device_id


async def adopt(db: AsyncSession, user: User, device_id: str) -> None:
    """A new device the app makes primary (the phone): unless the sources were ordered by hand."""
    if not await saved_ids(db, user.id):
        user.primary_device_id = device_id


async def forget_device(db: AsyncSession, user: User, device_id: str) -> None:
    """Before deleting a device (not committed): it leaves the sources, the next one becomes
    primary. The foreign key cascades too; this keeps the primary device in step."""
    await db.execute(delete(LocationSource).where(LocationSource.device_id == device_id))
    if user.primary_device_id == device_id:
        ids = await saved_ids(db, user.id)
        user.primary_device_id = ids[0] if ids else None


async def publish(ctx: AppContext, db: AsyncSession, user: User) -> None:
    """Tell me and the people who see me where I am now, if that changed since last time."""
    resolved = await resolve(db, user)
    key = (resolved.device.id, resolved.fix) if resolved else None
    pushed: dict[str, object] = ctx.extras.setdefault(_PUSHED, {})
    if user.id in pushed and pushed[user.id] == key:
        return
    pushed[user.id] = key
    ctx.hub.send_to_users([user.id], "me.location", my_location_out(resolved))
    recipients = await access.recipient_ids_of(db, user.id)
    if recipients:
        ctx.hub.send_to_users(
            recipients,
            "person.location",
            {
                "user_id": user.id,
                "location": resolved.fix if resolved else None,
                "device_name": resolved.device.name if resolved else None,
            },
        )


async def device_updated(ctx: AppContext, db: AsyncSession, device: Device) -> None:
    """A device has a new position or checked in: recompute its owner's if it is a source."""
    owner = await db.get(User, device.owner_id)
    if owner is not None and device.id in await source_ids(db, owner):
        await publish(ctx, db, owner)
