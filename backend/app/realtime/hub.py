"""In-memory WebSocket fan-out. One process, so a dict of live connections is enough."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Iterable
from typing import Any

from fastapi.encoders import jsonable_encoder

log = logging.getLogger(__name__)


class Connection:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.device_id: str | None = None
        self.queue: asyncio.Queue[dict[str, Any] | None] = asyncio.Queue(maxsize=512)

    def send(self, message: dict[str, Any]) -> None:
        try:
            self.queue.put_nowait(message)
        except asyncio.QueueFull:
            log.warning("dropping ws message for slow consumer user=%s", self.user_id)

    def close(self) -> None:
        try:
            self.queue.put_nowait(None)
        except asyncio.QueueFull:
            pass


def envelope(type_: str, data: Any) -> dict[str, Any]:
    return {"type": type_, "data": jsonable_encoder(data)}


class Hub:
    def __init__(self) -> None:
        self._by_user: dict[str, set[Connection]] = {}
        self._by_device: dict[str, set[Connection]] = {}

    def add(self, conn: Connection) -> None:
        self._by_user.setdefault(conn.user_id, set()).add(conn)

    def remove(self, conn: Connection) -> str | None:
        """Unregister a connection. Returns the device id if that device just went offline."""
        self._by_user.get(conn.user_id, set()).discard(conn)
        if not self._by_user.get(conn.user_id):
            self._by_user.pop(conn.user_id, None)
        return self._unbind(conn)

    def bind_device(self, conn: Connection, device_id: str) -> bool:
        """Bind a connection to its device. Returns True if the device just came online."""
        self._unbind(conn)
        conn.device_id = device_id
        conns = self._by_device.setdefault(device_id, set())
        was_offline = not conns
        conns.add(conn)
        return was_offline

    def _unbind(self, conn: Connection) -> str | None:
        device_id = conn.device_id
        if device_id is None:
            return None
        conn.device_id = None
        conns = self._by_device.get(device_id, set())
        conns.discard(conn)
        if not conns:
            self._by_device.pop(device_id, None)
            return device_id
        return None

    def device_online(self, device_id: str) -> bool:
        return bool(self._by_device.get(device_id))

    def online_device_ids(self) -> set[str]:
        return set(self._by_device)

    def send_to_users(self, user_ids: Iterable[str], type_: str, data: Any) -> None:
        msg = envelope(type_, data)
        for uid in set(user_ids):
            for conn in self._by_user.get(uid, ()):
                conn.send(msg)

    def send_to_device(self, device_id: str, type_: str, data: Any) -> int:
        msg = envelope(type_, data)
        conns = self._by_device.get(device_id, ())
        for conn in conns:
            conn.send(msg)
        return len(conns)

    def close_all(self) -> None:
        for conns in self._by_user.values():
            for conn in conns:
                conn.close()
