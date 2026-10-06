from __future__ import annotations

import logging
from datetime import timedelta

from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.context import AppContext
from app.i18n import t
from app.models import Command, CommandStatus, CommandType, Device, User
from app.providers.base import Capability, CommandError
from app.schemas import CommandIn, CommandOut
from app.services.devices import device_out

log = logging.getLogger(__name__)

TTL = {
    CommandType.PLAY_SOUND: timedelta(minutes=10),
    CommandType.LOST_MODE_ON: timedelta(days=7),
    CommandType.LOST_MODE_OFF: timedelta(days=7),
}
REQUIRED_CAPABILITY = {
    CommandType.PLAY_SOUND: Capability.PLAY_SOUND,
    CommandType.LOST_MODE_ON: Capability.LOST_MODE,
    CommandType.LOST_MODE_OFF: Capability.LOST_MODE,
}


def command_message(cmd: Command) -> dict:
    return {"id": cmd.id, "type": cmd.type, "payload": cmd.payload}


def _publish_status(ctx: AppContext, owner_id: str, cmd: Command) -> None:
    ctx.hub.send_to_users([owner_id], "command.updated", CommandOut.model_validate(cmd))


async def issue(
    ctx: AppContext, db: AsyncSession, user: User, device: Device, data: CommandIn
) -> Command:
    ctype = CommandType(data.type)
    provider = ctx.providers.get(device.kind)
    if provider is None or REQUIRED_CAPABILITY[ctype] not in provider.capabilities:
        raise HTTPException(status.HTTP_409_CONFLICT, "command not supported by this device")

    now = utcnow()
    payload: dict = {}
    previous_lost = (device.lost_enabled, device.lost_message, device.lost_phone, device.lost_since)
    if ctype == CommandType.LOST_MODE_ON:
        message = (data.message or "").strip()
        phone = (data.phone or "").strip() or None
        device.lost_enabled = True
        device.lost_message = message or None
        device.lost_phone = phone
        device.lost_since = now
        payload = {"message": message, "phone": phone, "owner_name": user.display_name}
    elif ctype == CommandType.LOST_MODE_OFF:
        device.lost_enabled = False
        device.lost_since = None

    # Only one live play_sound per device: supersede the previous one.
    if ctype == CommandType.PLAY_SOUND:
        await db.execute(
            update(Command)
            .where(
                Command.device_id == device.id,
                Command.type == CommandType.PLAY_SOUND,
                Command.status.in_([CommandStatus.PENDING, CommandStatus.DELIVERED]),
            )
            .values(status=CommandStatus.EXPIRED)
        )

    cmd = Command(
        device_id=device.id,
        issued_by=user.id,
        type=ctype,
        payload=payload,
        status=CommandStatus.PENDING,
        expires_at=now + TTL[ctype],
        created_at=now,
    )
    db.add(cmd)
    await db.flush()

    if provider.client_executed_commands:
        if ctx.hub.send_to_device(device.id, "command", command_message(cmd)):
            cmd.status, cmd.channel, cmd.delivered_at = CommandStatus.DELIVERED, "ws", now
        else:
            await db.commit()
            sent = 0
            if ctx.push is not None and ctype != CommandType.LOST_MODE_OFF:
                owner = user
                key = ctype.value
                params = {"message": payload.get("message") or ""}
                sent = await ctx.push.send_to_device(
                    db,
                    device.id,
                    {
                        "kind": "command",
                        "command": command_message(cmd),
                        "title": t(owner.locale, f"{key}.title", **params),
                        "body": t(owner.locale, f"{key}.body", **params),
                        "tag": f"cmd-{ctype.value}",
                        "url": f"/?cmd={cmd.id}",
                        "require_interaction": True,
                        "ttl": int(TTL[ctype].total_seconds()),
                    },
                )
            if sent:
                cmd.status, cmd.channel, cmd.delivered_at = CommandStatus.DELIVERED, "push", now
    else:
        try:
            await provider.execute_command(db, device, cmd)
            cmd.status, cmd.channel = CommandStatus.ACKED, "api"
            cmd.delivered_at = cmd.acked_at = utcnow()
        except CommandError as e:
            cmd.status, cmd.channel, cmd.error = CommandStatus.FAILED, "api", str(e)[:255]
            (device.lost_enabled, device.lost_message, device.lost_phone, device.lost_since) = (
                previous_lost
            )

    await db.commit()
    _publish_status(ctx, device.owner_id, cmd)
    if ctype != CommandType.PLAY_SOUND:
        ctx.hub.send_to_users([device.owner_id], "device.updated", device_out(ctx, device, user))
    return cmd


async def pending_for_device(db: AsyncSession, device_id: str) -> list[Command]:
    now = utcnow()
    rows = await db.execute(
        select(Command)
        .where(
            Command.device_id == device_id,
            Command.status.in_([CommandStatus.PENDING, CommandStatus.DELIVERED]),
            Command.expires_at > now,
            Command.type == CommandType.PLAY_SOUND,
        )
        .order_by(Command.created_at)
    )
    return list(rows.scalars().all())


async def mark_delivered(ctx: AppContext, db: AsyncSession, cmds: list[Command], channel: str):
    now = utcnow()
    changed = []
    for cmd in cmds:
        if cmd.status == CommandStatus.PENDING:
            cmd.status, cmd.channel, cmd.delivered_at = CommandStatus.DELIVERED, channel, now
            changed.append(cmd)
    await db.commit()
    for cmd in changed:
        device = await db.get(Device, cmd.device_id)
        if device:
            _publish_status(ctx, device.owner_id, cmd)


async def ack(
    ctx: AppContext,
    db: AsyncSession,
    device: Device,
    command_id: str,
    new_status: str,
    error: str | None = None,
) -> Command:
    cmd = await db.get(Command, command_id)
    if cmd is None or cmd.device_id != device.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "not found")
    if cmd.status in (CommandStatus.PENDING, CommandStatus.DELIVERED):
        now = utcnow()
        cmd.status = CommandStatus.ACKED if new_status == "acked" else CommandStatus.FAILED
        cmd.acked_at = now
        cmd.delivered_at = cmd.delivered_at or now
        cmd.error = error
        await db.commit()
        _publish_status(ctx, device.owner_id, cmd)
    return cmd


async def expire_old(ctx: AppContext, db: AsyncSession) -> None:
    now = utcnow()
    rows = (
        (
            await db.execute(
                select(Command).where(
                    Command.status.in_([CommandStatus.PENDING, CommandStatus.DELIVERED]),
                    Command.expires_at <= now,
                )
            )
        )
        .scalars()
        .all()
    )
    for cmd in rows:
        cmd.status = CommandStatus.EXPIRED
    await db.commit()
    for cmd in rows:
        device = await db.get(Device, cmd.device_id)
        if device:
            _publish_status(ctx, device.owner_id, cmd)
