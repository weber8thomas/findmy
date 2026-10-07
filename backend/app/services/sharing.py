from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app import access
from app.clock import utcnow
from app.context import AppContext
from app.models import Share, ShareStatus, User
from app.schemas import PersonOut, ShareOut, SharesOut
from app.services import avatars, sources
from app.services.notify import notify

LIVE = (ShareStatus.PENDING, ShareStatus.ACCEPTED)


def _is_active(share: Share, now: datetime) -> bool:
    return share.status == ShareStatus.ACCEPTED and (
        share.expires_at is None or share.expires_at > now
    )


async def share_out(db: AsyncSession, share: Share) -> ShareOut:
    owner = await db.get(User, share.owner_id)
    recipient = await db.get(User, share.recipient_id)
    return ShareOut(
        id=share.id,
        owner=await avatars.public_user(db, owner),
        recipient=await avatars.public_user(db, recipient),
        status=share.status,
        expires_at=share.expires_at,
        created_at=share.created_at,
        responded_at=share.responded_at,
    )


async def _publish(ctx: AppContext, db: AsyncSession, share: Share) -> None:
    ctx.hub.send_to_users(
        [share.owner_id, share.recipient_id], "share.updated", await share_out(db, share)
    )


async def create(
    ctx: AppContext, db: AsyncSession, owner: User, email: str, expires_at: datetime | None
) -> Share:
    recipient = (
        await db.execute(select(User).where(User.email == email.lower()))
    ).scalar_one_or_none()
    # Same error whether the user exists or not would hide accounts, but a family-scale
    # self-hosted instance favours a clear message.
    if recipient is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "no user with this email")
    if recipient.id == owner.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "cannot share with yourself")
    if expires_at is not None and expires_at <= utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "expiry must be in the future")
    existing = (
        await db.execute(
            select(Share).where(
                Share.owner_id == owner.id,
                Share.recipient_id == recipient.id,
                Share.status.in_(LIVE),
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "already sharing with this person")
    share = Share(owner_id=owner.id, recipient_id=recipient.id, expires_at=expires_at)
    db.add(share)
    await db.commit()
    await _publish(ctx, db, share)
    await notify(
        ctx,
        db,
        recipient.id,
        "share_invite",
        {"name": owner.display_name, "share_id": share.id},
        url="/people",
    )
    return share


async def _get(db: AsyncSession, share_id: str) -> Share:
    share = await db.get(Share, share_id)
    if share is None:
        raise access.not_found()
    return share


async def respond(
    ctx: AppContext, db: AsyncSession, user: User, share_id: str, accept: bool
) -> Share:
    share = await _get(db, share_id)
    if share.recipient_id != user.id:
        raise access.not_found()
    if share.status != ShareStatus.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, "invitation is no longer pending")
    share.status = ShareStatus.ACCEPTED if accept else ShareStatus.DECLINED
    share.responded_at = utcnow()
    await db.commit()
    await _publish(ctx, db, share)
    if accept:
        await notify(
            ctx, db, share.owner_id, "share_accepted", {"name": user.display_name}, url="/people"
        )
    return share


async def stop(ctx: AppContext, db: AsyncSession, user: User, share_id: str) -> Share:
    share = await _get(db, share_id)
    if user.id not in (share.owner_id, share.recipient_id):
        raise access.not_found()
    if share.status not in LIVE:
        return share
    share.status = ShareStatus.REVOKED
    share.responded_at = utcnow()
    await db.commit()
    await _publish(ctx, db, share)
    if user.id == share.owner_id:
        await notify(
            ctx,
            db,
            share.recipient_id,
            "share_stopped",
            {"name": user.display_name},
            url="/people",
        )
    return share


async def list_shares(db: AsyncSession, user: User) -> SharesOut:
    rows = (
        (
            await db.execute(
                select(Share)
                .where(
                    or_(Share.owner_id == user.id, Share.recipient_id == user.id),
                    Share.status.in_(LIVE),
                )
                .order_by(Share.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    incoming = [await share_out(db, s) for s in rows if s.recipient_id == user.id]
    outgoing = [await share_out(db, s) for s in rows if s.owner_id == user.id]
    return SharesOut(incoming=incoming, outgoing=outgoing)


async def people(db: AsyncSession, user: User) -> list[PersonOut]:
    now = utcnow()
    rows = (
        (
            await db.execute(
                select(Share).where(
                    or_(Share.owner_id == user.id, Share.recipient_id == user.id),
                    Share.status.in_(LIVE),
                )
            )
        )
        .scalars()
        .all()
    )
    by_person: dict[str, dict] = {}
    for s in rows:
        if s.status == ShareStatus.ACCEPTED and not _is_active(s, now):
            continue
        other = s.owner_id if s.recipient_id == user.id else s.recipient_id
        entry = by_person.setdefault(other, {"with_me": None, "i_share": None})
        if s.recipient_id == user.id:
            entry["with_me"] = s
        else:
            entry["i_share"] = s
    out: list[PersonOut] = []
    for other_id, entry in by_person.items():
        other = await db.get(User, other_id)
        if other is None:
            continue
        location = None
        device_name = None
        with_me: Share | None = entry["with_me"]
        if with_me is not None and _is_active(with_me, now):
            resolved = await sources.resolve(db, other)
            if resolved is not None:
                location = resolved.fix
                device_name = resolved.device.name
        out.append(
            PersonOut(
                user=await avatars.public_user(db, other),
                sharing_with_me=await share_out(db, with_me) if with_me else None,
                i_share_with=await share_out(db, entry["i_share"]) if entry["i_share"] else None,
                location=location,
                device_name=device_name,
            )
        )
    out.sort(key=lambda p: p.user.display_name.lower())
    return out


async def viewers(db: AsyncSession, user: User) -> list[ShareOut]:
    rows = (
        (
            await db.execute(
                select(Share).where(Share.owner_id == user.id, access.active_share_clause())
            )
        )
        .scalars()
        .all()
    )
    return [await share_out(db, s) for s in rows]


async def expire_old(ctx: AppContext, db: AsyncSession) -> None:
    now = utcnow()
    rows = (
        (
            await db.execute(
                select(Share).where(
                    Share.status.in_(LIVE), Share.expires_at.is_not(None), Share.expires_at <= now
                )
            )
        )
        .scalars()
        .all()
    )
    for s in rows:
        s.status = ShareStatus.EXPIRED
    await db.commit()
    for s in rows:
        await _publish(ctx, db, s)
