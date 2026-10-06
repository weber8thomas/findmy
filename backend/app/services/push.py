"""Web Push (VAPID). Best effort: failures never break the request that triggered them."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from cryptography.hazmat.primitives import serialization
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import Settings
from app.models import PushSubscription

log = logging.getLogger(__name__)

# (subscription, payload) -> HTTP status code returned by the push service
Sender = Callable[[PushSubscription, dict[str, Any]], Awaitable[int]]


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


class PushService:
    def __init__(self, settings: Settings, sender: Sender | None = None):
        self.settings = settings
        self.key_path = settings.data_dir / "vapid_private.pem"
        self._load_or_create_keys()
        self.sender: Sender = sender or self._webpush_sender

    def _load_or_create_keys(self) -> None:
        from py_vapid import Vapid

        if self.key_path.exists():
            vapid = Vapid.from_file(str(self.key_path))
        else:
            vapid = Vapid()
            vapid.generate_keys()
            vapid.save_key(str(self.key_path))
            os.chmod(self.key_path, 0o600)
        raw = vapid.public_key.public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        self.public_key = _b64url(raw)

    async def _webpush_sender(self, sub: PushSubscription, payload: dict[str, Any]) -> int:
        from pywebpush import WebPushException, webpush

        def _send() -> int:
            try:
                resp = webpush(
                    subscription_info={
                        "endpoint": sub.endpoint,
                        "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                    },
                    data=json.dumps(payload),
                    vapid_private_key=str(Path(self.key_path)),
                    vapid_claims={"sub": self.settings.vapid_subject},
                    ttl=payload.get("ttl", 3600),
                    timeout=10,
                )
                return getattr(resp, "status_code", 201)
            except WebPushException as e:
                return e.response.status_code if e.response is not None else 0

        return await asyncio.to_thread(_send)

    async def _deliver(self, db: AsyncSession, subs: list[PushSubscription], payload) -> int:
        sent = 0
        dead: list[str] = []
        for sub in subs:
            try:
                code = await self.sender(sub, payload)
            except Exception:  # network errors etc.
                log.exception("push send failed")
                code = 0
            if 200 <= code < 300:
                sent += 1
                sub.last_success_at = utcnow()
                sub.failure_count = 0
            elif code in (404, 410):
                dead.append(sub.id)
            else:
                sub.failure_count += 1
                if sub.failure_count >= 10:
                    dead.append(sub.id)
        if dead:
            await db.execute(delete(PushSubscription).where(PushSubscription.id.in_(dead)))
        await db.commit()
        return sent

    async def send_to_user(self, db: AsyncSession, user_id: str, payload: dict[str, Any]) -> int:
        subs = (
            (await db.execute(select(PushSubscription).where(PushSubscription.user_id == user_id)))
            .scalars()
            .all()
        )
        return await self._deliver(db, list(subs), payload)

    async def send_to_device(
        self, db: AsyncSession, device_id: str, payload: dict[str, Any]
    ) -> int:
        subs = (
            (
                await db.execute(
                    select(PushSubscription).where(PushSubscription.device_id == device_id)
                )
            )
            .scalars()
            .all()
        )
        return await self._deliver(db, list(subs), payload)
