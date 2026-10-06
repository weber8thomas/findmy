"""WebSocket endpoint: live updates for viewers, command delivery for devices."""

from __future__ import annotations

import asyncio
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.clock import utcnow
from app.context import AppContext
from app.deps import device_from_token, origin_allowed, session_user
from app.models import Device, User
from app.realtime.hub import Connection, envelope
from app.services import commands
from app.services.devices import lost_mode_out

log = logging.getLogger(__name__)
router = APIRouter()
_background: set[asyncio.Task] = set()


def _spawn(coro) -> None:
    """Run outside the connection's cancel scope (the socket task may already be cancelled)."""
    task = asyncio.create_task(coro)
    _background.add(task)
    task.add_done_callback(_background.discard)


async def _publish_status(ctx: AppContext, device_id: str, online: bool) -> None:
    async with ctx.sessionmaker() as db:
        device = await db.get(Device, device_id)
        if device is None:
            return
        if not online:
            device.last_seen_at = utcnow()
            await db.commit()
        ctx.hub.send_to_users(
            [device.owner_id],
            "device.status",
            {"device_id": device_id, "online": online, "last_seen_at": device.last_seen_at},
        )


async def _handle_hello(ctx: AppContext, conn: Connection, token: str | None) -> None:
    async with ctx.sessionmaker() as db:
        device = await device_from_token(token, db) if token else None
        if device is None or device.owner_id != conn.user_id:
            conn.send(envelope("welcome", {"user_id": conn.user_id, "device_id": None}))
            if token:
                conn.send(envelope("error", {"code": "invalid_device_token"}))
            return
        came_online = ctx.hub.bind_device(conn, device.id)
        device.last_seen_at = utcnow()
        await db.commit()
        owner = await db.get(User, device.owner_id)
        pending = await commands.pending_for_device(db, device.id)
        conn.send(
            envelope(
                "welcome",
                {
                    "user_id": conn.user_id,
                    "device_id": device.id,
                    "lost_mode": lost_mode_out(device, owner),
                },
            )
        )
        for cmd in pending:
            conn.send(envelope("command", commands.command_message(cmd)))
        await commands.mark_delivered(ctx, db, pending, "ws")
    if came_online:
        await _publish_status(ctx, device.id, True)


async def _handle_ack(ctx: AppContext, conn: Connection, data: dict) -> None:
    if conn.device_id is None:
        return
    async with ctx.sessionmaker() as db:
        device = await db.get(Device, conn.device_id)
        if device is None:
            return
        try:
            await commands.ack(
                ctx,
                db,
                device,
                str(data.get("command_id", "")),
                "failed" if data.get("status") == "failed" else "acked",
                (str(data["error"])[:255] if data.get("error") else None),
            )
        except Exception:
            log.debug("ack for unknown command ignored")


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    ctx: AppContext = ws.app.state.ctx
    if not origin_allowed(ws, ctx):
        await ws.close(code=4403)
        return
    async with ctx.sessionmaker() as db:
        found = await session_user(ws, db)
    if found is None:
        await ws.close(code=4401)
        return
    user = found[0]
    await ws.accept()
    conn = Connection(user.id)
    ctx.hub.add(conn)

    async def writer() -> None:
        while True:
            msg = await conn.queue.get()
            if msg is None:
                await ws.close()
                return
            await ws.send_json(msg)

    async def reader() -> None:
        while True:
            msg = await ws.receive_json()
            if not isinstance(msg, dict):
                continue
            mtype, data = msg.get("type"), msg.get("data") or {}
            if mtype == "ping":
                conn.send(envelope("pong", {}))
            elif mtype == "hello":
                await _handle_hello(ctx, conn, data.get("device_token"))
            elif mtype == "command.ack":
                await _handle_ack(ctx, conn, data)

    tasks = [asyncio.create_task(writer()), asyncio.create_task(reader())]
    try:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in pending:
            t.cancel()
        for t in done:
            exc = t.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                log.debug("ws task ended: %r", exc)
    finally:
        for t in tasks:
            t.cancel()
        went_offline = ctx.hub.remove(conn)
        if went_offline:
            _spawn(_publish_status(ctx, went_offline, False))
