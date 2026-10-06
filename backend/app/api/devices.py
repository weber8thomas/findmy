from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app import access
from app.clock import utcnow
from app.deps import DB, Ctx, CurrentUser, rate_limit
from app.models import Command, Device, DeviceKind
from app.providers.base import Capability, CommandError
from app.schemas import (
    CommandIn,
    CommandOut,
    DeviceCreate,
    DeviceCreated,
    DeviceOut,
    DeviceUpdate,
    HistoryOut,
    TokenOut,
)
from app.security import hash_token, new_device_token
from app.services import commands, locations
from app.services.devices import device_out

router = APIRouter(prefix="/devices", tags=["devices"])


@router.get("", response_model=list[DeviceOut])
async def list_devices(user: CurrentUser, ctx: Ctx, db: DB):
    rows = (
        (
            await db.execute(
                select(Device).where(Device.owner_id == user.id).order_by(Device.created_at)
            )
        )
        .scalars()
        .all()
    )
    return [device_out(ctx, d, user) for d in rows]


@router.post("", response_model=DeviceCreated, status_code=201)
async def create_device(data: DeviceCreate, user: CurrentUser, ctx: Ctx, db: DB):
    if data.kind == DeviceKind.OWNTRACKS and not ctx.settings.feature_owntracks:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "OwnTracks is disabled")
    token = new_device_token()
    device = Device(
        owner_id=user.id,
        name=data.name.strip(),
        kind=data.kind,
        icon=data.icon,
        token_hash=hash_token(token),
        provider_config={},
    )
    db.add(device)
    await db.flush()
    if user.primary_device_id is None and data.kind in (DeviceKind.BROWSER, DeviceKind.OWNTRACKS):
        user.primary_device_id = device.id
    await db.commit()
    return DeviceCreated(device=device_out(ctx, device, user), device_token=token)


@router.get("/{device_id}", response_model=DeviceOut)
async def get_device(device_id: str, user: CurrentUser, ctx: Ctx, db: DB):
    return device_out(ctx, await access.get_owned_device(db, user, device_id), user)


@router.patch("/{device_id}", response_model=DeviceOut)
async def update_device(device_id: str, data: DeviceUpdate, user: CurrentUser, ctx: Ctx, db: DB):
    device = await access.get_owned_device(db, user, device_id)
    if data.name is not None:
        device.name = data.name.strip()
    if data.icon is not None:
        device.icon = data.icon
    await db.commit()
    out = device_out(ctx, device, user)
    ctx.hub.send_to_users([user.id], "device.updated", out)
    return out


@router.delete("/{device_id}", status_code=204)
async def delete_device(device_id: str, user: CurrentUser, ctx: Ctx, db: DB):
    device = await access.get_owned_device(db, user, device_id)
    if user.primary_device_id == device.id:
        user.primary_device_id = None
    await db.delete(device)
    await db.commit()
    ctx.hub.send_to_users([user.id], "device.removed", {"device_id": device_id})


@router.post("/{device_id}/rotate-token", response_model=TokenOut)
async def rotate_token(device_id: str, user: CurrentUser, db: DB):
    device = await access.get_owned_device(db, user, device_id)
    if device.token_hash is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "this device has no token")
    token = new_device_token()
    device.token_hash = hash_token(token)
    await db.commit()
    return TokenOut(device_token=token)


@router.get("/{device_id}/locations", response_model=HistoryOut)
async def device_history(
    device_id: str,
    user: CurrentUser,
    db: DB,
    start: datetime | None = Query(default=None, alias="from"),
    end: datetime | None = Query(default=None, alias="to"),
    max_points: int = Query(default=1000, ge=2, le=5000),
):
    device = await access.get_owned_device(db, user, device_id)
    end = end or utcnow()
    start = start or end - timedelta(hours=24)
    if start.tzinfo is None or end.tzinfo is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "timestamps need a timezone")
    points, total = await locations.history(db, device, start, end, max_points)
    return HistoryOut(device_id=device.id, points=points, total=total)


@router.post("/{device_id}/commands", response_model=CommandOut, status_code=201)
async def send_command(device_id: str, data: CommandIn, user: CurrentUser, ctx: Ctx, db: DB):
    rate_limit(ctx, "commands", user.id, 20, 60)
    device = await access.get_owned_device(db, user, device_id)
    return await commands.issue(ctx, db, user, device, data)


@router.get("/{device_id}/commands", response_model=list[CommandOut])
async def list_commands(
    device_id: str, user: CurrentUser, db: DB, limit: int = Query(default=20, ge=1, le=100)
):
    device = await access.get_owned_device(db, user, device_id)
    rows = await db.execute(
        select(Command)
        .where(Command.device_id == device.id)
        .order_by(Command.created_at.desc())
        .limit(limit)
    )
    return list(rows.scalars().all())


@router.post("/{device_id}/refresh", status_code=202)
async def refresh_device(device_id: str, user: CurrentUser, ctx: Ctx, db: DB):
    """Ask a server-side provider (iCloud, Find My network) for a fresh position now."""
    rate_limit(ctx, "refresh", device_id, 1, 30)
    device = await access.get_owned_device(db, user, device_id)
    provider = ctx.providers.get(device.kind)
    if provider is None or Capability.REFRESH not in provider.capabilities:
        raise HTTPException(status.HTTP_409_CONFLICT, "refresh not supported by this device")
    try:
        await provider.refresh(device)
    except CommandError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from None
    return {"status": "requested"}
