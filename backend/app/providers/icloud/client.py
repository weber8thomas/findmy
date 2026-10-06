"""Adapter around pyicloud (the private iCloud web API behind icloud.com/find).

pyicloud is synchronous: every call runs in a worker thread. It is imported lazily so
the app runs without the optional dependency.
"""

from __future__ import annotations

import asyncio
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.providers.apple_base import AppleAuthError


@dataclass(frozen=True)
class ICloudSnapshot:
    icloud_id: str
    name: str
    model: str
    lat: float | None
    lon: float | None
    accuracy: float | None
    ts: datetime | None
    battery_level: float | None
    charging: bool | None


def _auth_errors() -> tuple[type[Exception], ...]:
    from pyicloud.exceptions import (
        PyiCloud2FARequiredException,
        PyiCloud2SARequiredException,
        PyiCloudAuthRequiredException,
        PyiCloudFailedLoginException,
    )

    return (
        PyiCloudFailedLoginException,
        PyiCloud2FARequiredException,
        PyiCloud2SARequiredException,
        PyiCloudAuthRequiredException,
    )


def snapshot_from(content: dict[str, Any]) -> ICloudSnapshot:
    loc = content.get("location") or {}
    ts_ms = loc.get("timeStamp")
    battery = content.get("batteryLevel")
    status = content.get("batteryStatus")
    return ICloudSnapshot(
        icloud_id=str(content.get("id")),
        name=str(content.get("name") or ""),
        model=str(content.get("deviceDisplayName") or content.get("deviceModel") or ""),
        lat=loc.get("latitude"),
        lon=loc.get("longitude"),
        accuracy=loc.get("horizontalAccuracy"),
        ts=datetime.fromtimestamp(ts_ms / 1000, UTC) if ts_ms else None,
        battery_level=float(battery) if isinstance(battery, int | float) and battery > 0 else None,
        charging={"Charging": True, "Charged": True, "NotCharging": False}.get(status),
    )


class ICloudPyClient:
    def __init__(self, state: dict[str, Any] | None, *, cookie_dir: Path):
        self.state = dict(state or {})
        self.cookie_dir = cookie_dir
        self.api: Any = None

    def _make_api(self, apple_id: str, password: str) -> Any:
        from pyicloud import PyiCloudService

        self.cookie_dir.mkdir(parents=True, exist_ok=True)
        os.chmod(self.cookie_dir, 0o700)
        try:
            return PyiCloudService(apple_id, password, cookie_directory=str(self.cookie_dir))
        except _auth_errors() as e:
            raise AppleAuthError("invalid Apple ID or password") from e

    async def _ensure_api(self) -> Any:
        if self.api is None:
            if not self.state.get("apple_id"):
                raise AppleAuthError("not signed in")
            self.api = await asyncio.to_thread(
                self._make_api, self.state["apple_id"], self.state["password"]
            )
        if self.api.requires_2fa or self.api.requires_2sa:
            raise AppleAuthError("Apple asks for a new verification code")
        return self.api

    async def _call(self, fn, *args):
        try:
            return await asyncio.to_thread(fn, *args)
        except _auth_errors() as e:
            self.api = None
            raise AppleAuthError("Apple session expired") from e

    async def login(self, username: str, password: str) -> str:
        self.api = await asyncio.to_thread(self._make_api, username, password)
        self.state = {"apple_id": username, "password": password}
        return "require_2fa" if (self.api.requires_2fa or self.api.requires_2sa) else "logged_in"

    async def get_2fa_methods(self) -> list[dict[str, str]]:
        return [
            {"id": "trusted_device", "type": "trusted_device", "label": "Trusted device"},
            {"id": "sms", "type": "sms", "label": "SMS"},
        ]

    async def request_2fa(self, method_id: str) -> None:
        # Apple pushes the code to trusted devices on sign-in; SMS must be asked for.
        if method_id == "sms":
            await asyncio.to_thread(self.api.request_2fa_code)

    async def submit_2fa(self, method_id: str, code: str) -> str:
        if not await asyncio.to_thread(self.api.validate_2fa_code, code):
            raise AppleAuthError("invalid code")
        if not self.api.is_trusted_session:
            await asyncio.to_thread(self.api.trust_session)
        return "logged_in"

    async def list_devices(self) -> list[ICloudSnapshot]:
        api = await self._ensure_api()

        def _list():
            return [snapshot_from(d.data) for d in api.devices]

        return await self._call(_list)

    async def locate(self) -> dict[str, ICloudSnapshot]:
        api = await self._ensure_api()

        def _locate():
            api.devices.refresh(locate=True)
            return {s.icloud_id: s for s in (snapshot_from(d.data) for d in api.devices)}

        return await self._call(_locate)

    async def play_sound(self, icloud_id: str) -> None:
        api = await self._ensure_api()
        await self._call(lambda: api.devices[icloud_id].play_sound("Locus"))

    async def lost_mode(self, icloud_id: str, phone: str, message: str) -> None:
        api = await self._ensure_api()
        await self._call(lambda: api.devices[icloud_id].lost_device(phone, message))

    def export_state(self) -> dict[str, Any]:
        return dict(self.state)

    async def close(self) -> None:
        self.api = None
