"""Profile photos: stored in their own table, served by /api/users/{id}/avatar."""

from __future__ import annotations

from datetime import datetime

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.models import AvatarSource, User, UserAvatar
from app.schemas import PublicUser, UserOut

# The app uploads a 256 px JPEG of a few tens of KB; this leaves room for SSO pictures.
MAX_BYTES = 300_000

RASTER_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}


def sniff(data: bytes) -> str | None:
    """The image type from the file's first bytes; None for anything else (SVG included)."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def url(user_id: str, updated_at: datetime) -> str:
    # The version lets browsers cache the image until it changes.
    return f"/api/users/{user_id}/avatar?v={int(updated_at.timestamp() * 1000)}"


async def avatar_url(db: AsyncSession, user_id: str) -> str | None:
    updated_at = (
        await db.execute(select(UserAvatar.updated_at).where(UserAvatar.user_id == user_id))
    ).scalar_one_or_none()
    return url(user_id, updated_at) if updated_at else None


async def public_user(db: AsyncSession, user: User) -> PublicUser:
    out = PublicUser.model_validate(user)
    out.avatar_url = await avatar_url(db, user.id)
    return out


async def user_out(db: AsyncSession, user: User) -> UserOut:
    out = UserOut.model_validate(user)
    out.avatar_url = await avatar_url(db, user.id)
    return out


async def save(db: AsyncSession, user_id: str, data: bytes, source: AvatarSource) -> bool:
    """Store a photo (not committed); False if it is unchanged. 415/413 if it is not one."""
    if len(data) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "image too large")
    content_type = sniff(data)
    if content_type is None:
        raise HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE, "PNG, JPEG, WebP or GIF images only"
        )
    row = await db.get(UserAvatar, user_id)
    if row is None:
        row = UserAvatar(user_id=user_id)
        db.add(row)
    elif row.data == data and row.source == source:
        return False
    row.content_type, row.data, row.source, row.updated_at = content_type, data, source, utcnow()
    return True


async def remove(db: AsyncSession, user_id: str) -> None:
    row = await db.get(UserAvatar, user_id)
    if row is not None:
        await db.delete(row)
