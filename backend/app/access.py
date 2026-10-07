"""Authorization rules, in one place.

- An owner sees and controls all of their devices.
- A user who receives an accepted, unexpired share sees only the sharer's location, taken from
  one of their sources (services/sources; the primary device by default), and the name of
  that device: no history, no battery, no commands, not the list of their devices.
- A profile photo is seen by its owner, by both sides of an accepted, unexpired share, and
  by whoever a pending invitation is addressed to (not by the inviter before acceptance).
- Anything else is reported as 404, never 403, so ids cannot be probed.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import Device, Share, ShareStatus, User


def not_found() -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, "not found")


def active_share_clause(now: datetime | None = None):
    now = now or utcnow()
    return and_(
        Share.status == ShareStatus.ACCEPTED,
        or_(Share.expires_at.is_(None), Share.expires_at > now),
    )


async def get_owned_device(db: AsyncSession, user: User, device_id: str) -> Device:
    device = await db.get(Device, device_id)
    if device is None or device.owner_id != user.id:
        raise not_found()
    return device


async def owner_ids_sharing_with(db: AsyncSession, user_id: str) -> list[str]:
    """Users who currently share their location with `user_id`."""
    rows = await db.execute(
        select(Share.owner_id).where(Share.recipient_id == user_id, active_share_clause())
    )
    return [r[0] for r in rows]


async def recipient_ids_of(db: AsyncSession, owner_id: str) -> list[str]:
    """Users who can currently see `owner_id`'s location."""
    rows = await db.execute(
        select(Share.recipient_id).where(Share.owner_id == owner_id, active_share_clause())
    )
    return [r[0] for r in rows]


async def device_viewers(db: AsyncSession, device: Device) -> tuple[str, list[str]]:
    """(owner id, ids of people who follow this device as the owner): only for the primary
    device, the one their zone alerts watch."""
    owner = await db.get(User, device.owner_id)
    recipients: list[str] = []
    if owner is not None and owner.primary_device_id == device.id:
        recipients = await recipient_ids_of(db, owner.id)
    return device.owner_id, recipients


async def can_see_photo(db: AsyncSession, user: User, owner_id: str) -> bool:
    """Whether `user` may see the profile photo of `owner_id`."""
    if owner_id == user.id:
        return True
    now = utcnow()
    between = or_(
        and_(Share.owner_id == owner_id, Share.recipient_id == user.id),
        and_(Share.owner_id == user.id, Share.recipient_id == owner_id),
    )
    invited_by_owner = and_(
        Share.owner_id == owner_id,
        Share.recipient_id == user.id,
        Share.status == ShareStatus.PENDING,
        or_(Share.expires_at.is_(None), Share.expires_at > now),
    )
    row = await db.execute(
        select(Share.id).where(or_(and_(between, active_share_clause(now)), invited_by_owner))
    )
    return row.first() is not None


async def can_see_device(db: AsyncSession, user: User, device: Device) -> bool:
    if device.owner_id == user.id:
        return True
    owner_id, recipients = await device_viewers(db, device)
    return user.id in recipients
