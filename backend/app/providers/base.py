"""Location providers: where device positions come from.

Every provider feeds positions through the same pipeline (`services.locations.ingest`),
so the map, history, sharing and zones work the same whatever the source.
"""

from __future__ import annotations

import asyncio
import logging
import random
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, ClassVar

from fastapi import APIRouter

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from app.context import AppContext
    from app.models import Command, Device

log = logging.getLogger(__name__)


class Capability(StrEnum):
    REALTIME = "realtime"  # positions pushed live while the device is online
    PLAY_SOUND = "play_sound"
    LOST_MODE = "lost_mode"
    REFRESH = "refresh"  # server can request a fresh position on demand


@dataclass(frozen=True)
class LocationFix:
    ts: datetime
    lat: float
    lon: float
    accuracy_m: float | None = None
    altitude_m: float | None = None
    speed_mps: float | None = None
    heading_deg: float | None = None
    battery_level: float | None = None
    battery_charging: bool | None = None
    battery_label: str | None = None


class CommandError(Exception):
    pass


class Provider:
    kind: ClassVar[str]
    capabilities: ClassVar[frozenset[Capability]] = frozenset()
    # Sparse providers report rarely (crowd-sourced networks): geofences trust a single fix.
    sparse: ClassVar[bool] = False
    # Commands are executed by the device itself (delivered over WebSocket / push),
    # as opposed to being executed server-side through a remote API.
    client_executed_commands: ClassVar[bool] = False

    def routers(self) -> list[APIRouter]:
        return []

    async def start(self, ctx: AppContext) -> None:
        self.ctx = ctx

    async def stop(self) -> None:
        pass

    async def execute_command(self, db: AsyncSession, device: Device, command: Command) -> None:
        raise CommandError("unsupported")

    async def refresh(self, device: Device) -> None:
        raise CommandError("unsupported")


class PollingProvider(Provider):
    """Runs `poll_once()` in the background every `interval_s` (±10% jitter)."""

    interval_s: float = 300

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._wake = asyncio.Event()

    async def start(self, ctx: AppContext) -> None:
        await super().start(ctx)
        self._task = asyncio.create_task(self._run(), name=f"poller-{self.kind}")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass

    def wake(self) -> None:
        self._wake.set()

    async def _run(self) -> None:
        while True:
            try:
                await self.poll_once()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("%s poll failed", self.kind)
            delay = self.interval_s * random.uniform(0.9, 1.1)
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=delay)
            except TimeoutError:
                pass
            self._wake.clear()

    async def poll_once(self) -> None:  # pragma: no cover - abstract
        raise NotImplementedError


class ProviderRegistry:
    def __init__(self, providers: list[Provider]):
        self._by_kind = {p.kind: p for p in providers}

    def get(self, kind: str) -> Provider | None:
        return self._by_kind.get(kind)

    def all(self) -> list[Provider]:
        return list(self._by_kind.values())

    def kinds(self) -> list[str]:
        return list(self._by_kind)

    def capabilities(self, kind: str) -> list[str]:
        p = self.get(kind)
        return sorted(p.capabilities) if p else []

    def is_sparse(self, kind: str) -> bool:
        p = self.get(kind)
        return bool(p and p.sparse)

    async def start(self, ctx: AppContext) -> None:
        for p in self._by_kind.values():
            await p.start(ctx)

    async def stop(self) -> None:
        for p in self._by_kind.values():
            await p.stop()
