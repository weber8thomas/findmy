"""Low battery: the people who see me hear of it before my location stops, if I chose so."""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy.ext.asyncio import AsyncSession

from app import access
from app.clock import utcnow
from app.context import AppContext
from app.models import Device, User, UserPrefs
from app.services import sources
from app.services.notify import notify

LOW = 0.15
# One alert per device in this time: a level that wavers around the threshold says it once.
QUIET = timedelta(hours=6)
_SENT = "battery_low_sent"


async def battery_alerts(db: AsyncSession, user_id: str) -> bool:
    prefs = await db.get(UserPrefs, user_id)
    return bool(prefs and prefs.battery_alerts)


async def set_battery_alerts(db: AsyncSession, user_id: str, on: bool) -> None:
    prefs = await db.get(UserPrefs, user_id)
    if prefs is None:
        db.add(UserPrefs(user_id=user_id, battery_alerts=on))
    else:
        prefs.battery_alerts = on
    await db.commit()


async def check(ctx: AppContext, db: AsyncSession, device: Device, before: float | None) -> None:
    """After a report: the device fell below LOW, unplugged, and it is where its owner's location
    comes from now. A first report already low says nothing: it did not fall."""
    after = device.battery_level
    if before is None or after is None or not before >= LOW > after or device.battery_charging:
        return
    owner = await db.get(User, device.owner_id)
    if owner is None or not await battery_alerts(db, owner.id):
        return
    resolved = await sources.resolve(db, owner)
    if resolved is None or resolved.device.id != device.id:
        return
    sent: dict[str, datetime] = ctx.extras.setdefault(_SENT, {})
    now = utcnow()
    last = sent.get(device.id)
    if last is not None and now - last < QUIET:
        return
    sent[device.id] = now
    for recipient in await access.recipient_ids_of(db, owner.id):
        await notify(
            ctx,
            db,
            recipient,
            "battery_low",
            {
                "who": owner.display_name,
                "device": device.name,
                "level": round(after * 100),
                "user_id": owner.id,
            },
            url=f"/people/{owner.id}",
        )
