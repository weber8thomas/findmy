"""iCloud provider: locate Apple devices (iPhone, iPad, Mac, Watch) through the same private
web API as icloud.com/find, with Apple's own play-sound and Lost Mode. Unofficial, opt-in.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import Settings
from app.deps import DB, Ctx, CurrentUser, rate_limit
from app.models import Command, CommandType, Device, DeviceKind, ProviderAccount, User
from app.providers.apple_base import AppleAccountProvider, AppleAuthError, AppleClient
from app.providers.base import Capability, CommandError, LocationFix
from app.providers.icloud import client as ic
from app.schemas import DeviceOut
from app.services import locations
from app.services.devices import device_out

log = logging.getLogger(__name__)


class TrackIn(BaseModel):
    icloud_device_id: str = Field(min_length=1, max_length=200)
    name: str | None = Field(default=None, max_length=80)


PRIMARY_RANK = {"phone": 0, "laptop": 1, "desktop": 1, "tablet": 2, "watch": 3}
# How long a device can be missing from the Apple account before Oukilé deletes it.
GONE_AFTER = timedelta(hours=1)


def _new_device(owner_id: str, snap: ic.ICloudSnapshot, name: str | None = None) -> Device:
    return Device(
        owner_id=owner_id,
        name=(name or snap.name or snap.model or "Apple device").strip()[:80],
        kind=DeviceKind.ICLOUD,
        icon=_icon_for(snap.model),
        token_hash=None,
        provider_config={"icloud_device_id": snap.icloud_id, "model": snap.model},
    )


def _icon_for(model: str) -> str:
    m = model.lower()
    if "ipad" in m:
        return "tablet"
    if "mac" in m:
        return "laptop"
    if "watch" in m:
        return "watch"
    if "airpods" in m or "beats" in m:
        return "earbuds"
    return "phone"


class ICloudProvider(AppleAccountProvider):
    kind = DeviceKind.ICLOUD
    provider_name = "icloud"
    capabilities = frozenset({Capability.PLAY_SOUND, Capability.LOST_MODE, Capability.REFRESH})
    min_interval_s = 60

    def __init__(self, settings: Settings):
        super().__init__(settings, settings.icloud_poll_interval_s)
        self.auto_track = settings.icloud_auto_track

    def cookie_dir(self, user_id: str) -> Path:
        return self.settings.data_dir / "icloud" / user_id

    def new_client(self, user_id: str, state: dict[str, Any] | None) -> AppleClient:
        return ic.ICloudPyClient(state, cookie_dir=self.cookie_dir(user_id))

    async def poll_account(
        self, db: AsyncSession, account: ProviderAccount, client: AppleClient, devices: list[Device]
    ) -> None:
        snapshots = await client.locate()  # type: ignore[attr-defined]
        if self.auto_track:
            devices = devices + await self._add_new_devices(db, account, snapshots, devices)
        if snapshots:
            devices = await self._drop_removed(db, account, snapshots, devices)
        for device in devices:
            snap = snapshots.get((device.provider_config or {}).get("icloud_device_id"))
            if snap is None or snap.lat is None or snap.lon is None or snap.ts is None:
                continue
            fix = LocationFix(
                ts=snap.ts,
                lat=snap.lat,
                lon=snap.lon,
                accuracy_m=snap.accuracy,
                battery_level=snap.battery_level,
                battery_charging=snap.charging,
            )
            await locations.ingest(self.ctx, db, device, [fix], source="icloud")

    async def _add_new_devices(
        self,
        db: AsyncSession,
        account: ProviderAccount,
        snapshots: dict[str, ic.ICloudSnapshot],
        devices: list[Device],
    ) -> list[Device]:
        """Track every device of the Apple account, like the Find My app lists them all."""
        known = {(d.provider_config or {}).get("icloud_device_id") for d in devices}
        added = [
            _new_device(account.user_id, snap)
            for icloud_id, snap in snapshots.items()
            if icloud_id not in known
        ]
        if not added:
            return []
        db.add_all(added)
        await db.flush()
        owner = await db.get(User, account.user_id)
        if owner is not None:
            if owner.primary_device_id is None:
                # The primary device is the one shared with people: prefer a phone, never AirPods.
                ranked = sorted(
                    (d for d in added if d.icon in PRIMARY_RANK), key=lambda d: PRIMARY_RANK[d.icon]
                )
                if ranked:
                    owner.primary_device_id = ranked[0].id
            for device in added:
                self.ctx.hub.send_to_users(
                    [owner.id], "device.updated", device_out(self.ctx, device, owner)
                )
        log.info("iCloud: now tracking %d new device(s)", len(added))
        return added

    async def _drop_removed(
        self,
        db: AsyncSession,
        account: ProviderAccount,
        snapshots: dict[str, ic.ICloudSnapshot],
        devices: list[Device],
    ) -> list[Device]:
        """A device removed from the Apple account leaves Oukilé too. It is flagged at once and
        deleted after GONE_AFTER, as Apple can leave a device out of one answer."""
        now = utcnow()
        kept: list[Device] = []
        for device in devices:
            cfg = device.provider_config or {}
            missing = cfg.get("missing_since")
            if cfg.get("icloud_device_id") in snapshots:
                if missing:
                    device.provider_config = {k: v for k, v in cfg.items() if k != "missing_since"}
                kept.append(device)
            elif missing is None:
                device.provider_config = {**cfg, "missing_since": now.isoformat()}
                kept.append(device)
            elif now - datetime.fromisoformat(missing) < GONE_AFTER:
                kept.append(device)
            else:
                owner = await db.get(User, account.user_id)
                if owner is not None and owner.primary_device_id == device.id:
                    owner.primary_device_id = None
                await db.delete(device)
                self.ctx.hub.send_to_users(
                    [account.user_id], "device.removed", {"device_id": device.id}
                )
                log.info("iCloud: %s is no longer on the Apple account, removed", device.id)
        return kept

    async def refresh(self, device: Device) -> None:
        await self.request_refresh(device)

    async def execute_command(self, db: AsyncSession, device: Device, command: Command) -> None:
        account = await self.get_account(db, device.owner_id)
        if account is None or account.state != "logged_in":
            raise CommandError("Apple account not connected")
        icloud_id = (device.provider_config or {}).get("icloud_device_id")
        async with self.lock(account.id):
            client = await self.client_for(account)
            try:
                if command.type == CommandType.PLAY_SOUND:
                    await client.play_sound(icloud_id)  # type: ignore[attr-defined]
                elif command.type == CommandType.LOST_MODE_ON:
                    await client.lost_mode(  # type: ignore[attr-defined]
                        icloud_id,
                        device.lost_phone or "",
                        device.lost_message or "This device has been lost. Please call me.",
                    )
                # LOST_MODE_OFF: the iCloud API has no "stop" call; Apple's Lost Mode ends when
                # the device is unlocked with its passcode. We only clear Oukilé's flag.
            except AppleAuthError as e:
                await self.mark_reauth(db, account, str(e))
                raise CommandError(str(e)) from e
            except CommandError:
                raise
            except Exception as e:
                raise CommandError(f"iCloud error: {e}") from e

    def routers(self) -> list[APIRouter]:
        router = APIRouter(prefix="/providers/icloud", tags=["icloud"])
        provider = self

        async def _client(db, user):
            account = await provider.get_account(db, user.id)
            if account is None or account.state != "logged_in":
                raise HTTPException(status.HTTP_409_CONFLICT, "Apple account not connected")
            return account, await provider.client_for(account)

        @router.get("/devices")
        async def list_icloud_devices(user: CurrentUser, ctx: Ctx, db: DB):
            rate_limit(ctx, "icloud-list", user.id, 10, 60)
            account, client = await _client(db, user)
            try:
                async with provider.lock(account.id):
                    snaps = await client.list_devices()  # type: ignore[attr-defined]
            except AppleAuthError as e:
                await provider.mark_reauth(db, account, str(e))
                raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from None
            log.info("iCloud returned %d device(s)", len(snaps))
            tracked = {
                (d.provider_config or {}).get("icloud_device_id"): d.id
                for d in (
                    await db.execute(
                        select(Device).where(
                            Device.owner_id == user.id, Device.kind == DeviceKind.ICLOUD
                        )
                    )
                ).scalars()
            }
            return [
                {
                    "icloud_device_id": s.icloud_id,
                    "name": s.name,
                    "model": s.model,
                    "tracked_device_id": tracked.get(s.icloud_id),
                }
                for s in snaps
            ]

        @router.post("/devices", response_model=DeviceOut, status_code=201)
        async def track_icloud_device(data: TrackIn, user: CurrentUser, ctx: Ctx, db: DB):
            account, client = await _client(db, user)
            async with provider.lock(account.id):
                snaps = {s.icloud_id: s for s in await client.list_devices()}  # type: ignore[attr-defined]
            snap = snaps.get(data.icloud_device_id)
            if snap is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "device not found in iCloud")
            device = _new_device(user.id, snap, data.name)
            db.add(device)
            await db.flush()
            if user.primary_device_id is None:
                user.primary_device_id = device.id
            await db.commit()
            account.next_poll_at = None
            await db.commit()
            provider.wake()
            return device_out(ctx, device, user)

        return [self.account_router(), router]
