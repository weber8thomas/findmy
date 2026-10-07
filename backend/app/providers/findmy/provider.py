"""Apple Find My network provider: AirTags and OpenHaystack DIY tags (unofficial, opt-in).

Positions come from crowd-sourced reports uploaded by nearby Apple devices, so they are
sparse and typically minutes to an hour old.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import Settings
from app.deps import DB, Ctx, CurrentUser, rate_limit
from app.models import Device, DeviceKind, ProviderAccount
from app.providers.apple_base import AppleAccountProvider, AppleClient
from app.providers.base import Capability, LocationFix
from app.providers.findmy import client as fm
from app.schemas import DeviceOut
from app.services import locations
from app.services.devices import device_out

MAX_UPLOAD = 256 * 1024

# Words of an item's name (French or English, without accents) and the icon they suggest.
NAME_ICONS = {
    "cle": "key",
    "clef": "key",
    "key": "key",
    "voiture": "car",
    "car": "car",
    "auto": "car",
    "sac": "backpack",
    "bag": "backpack",
    "portefeuille": "wallet",
    "wallet": "wallet",
    "velo": "bike",
    "bike": "bike",
    "valise": "suitcase",
    "suitcase": "suitcase",
    "chien": "pet",
    "chat": "pet",
    "dog": "pet",
    "cat": "pet",
}


def _icon_for_name(name: str) -> str:
    """A first icon from the name ("Clés de Marco" -> key); the owner can change it."""
    plain = unicodedata.normalize("NFKD", name.lower()).encode("ascii", "ignore").decode()
    for word in re.findall(r"[a-z]+", plain):
        icon = NAME_ICONS.get(word) or NAME_ICONS.get(word.removesuffix("s"))
        if icon:
            return icon
    return "tag"


class GenerateIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class FindMyProvider(AppleAccountProvider):
    kind = DeviceKind.FINDMY
    provider_name = "findmy"
    capabilities = frozenset({Capability.REFRESH})
    sparse = True
    min_interval_s = 120

    def __init__(self, settings: Settings):
        super().__init__(settings, settings.findmy_poll_interval_s)
        # Swappable for tests.
        self.toolkit = fm

    def new_client(self, user_id: str, state: dict[str, Any] | None) -> AppleClient:
        return fm.FindMyPyClient(
            state,
            anisette_url=self.settings.anisette_url,
            libs_path=self.settings.data_dir / "findmy" / "ani_libs.bin",
        )

    async def poll_account(
        self, db: AsyncSession, account: ProviderAccount, client: AppleClient, devices: list[Device]
    ) -> None:
        items = [(d.id, self.ctx.box.decrypt_json(d.secret_blob)) for d in devices if d.secret_blob]
        reports, updated = await client.fetch(items)  # type: ignore[attr-defined]
        for device in devices:
            if device.id in updated:
                device.secret_blob = self.ctx.box.encrypt_json(updated[device.id])
            is_airtag = (device.provider_config or {}).get("item_type") == "airtag"
            fixes = []
            for r in reports.get(device.id, []):
                battery = fm.battery_from_status(r.status) if is_airtag else None
                fixes.append(
                    LocationFix(
                        ts=r.ts,
                        lat=r.lat,
                        lon=r.lon,
                        accuracy_m=r.accuracy,
                        battery_label=battery[0] if battery else None,
                        battery_level=battery[1] if battery else None,
                    )
                )
            if fixes:
                await locations.ingest(self.ctx, db, device, fixes, source="findmy")
        await db.commit()

    async def refresh(self, device: Device) -> None:
        await self.request_refresh(device)

    def routers(self) -> list[APIRouter]:
        items = APIRouter(prefix="/items", tags=["findmy"])
        provider = self

        async def _create(db, ctx, user, name: str, item_type: str, secret: dict, cfg: dict):
            device = Device(
                owner_id=user.id,
                name=name.strip(),
                kind=DeviceKind.FINDMY,
                icon=_icon_for_name(name),
                token_hash=None,
                provider_config={"item_type": item_type, **cfg},
                secret_blob=ctx.box.encrypt_json(secret),
            )
            db.add(device)
            await db.commit()
            provider.wake()
            return device_out(ctx, device, user)

        @items.post("", response_model=DeviceOut, status_code=201)
        async def add_item(
            user: CurrentUser,
            ctx: Ctx,
            db: DB,
            name: str = Form(min_length=1, max_length=80),
            type: str = Form(pattern="^(haystack|airtag)$"),
            private_key_b64: str | None = Form(default=None, max_length=200),
            plist: UploadFile | None = File(default=None),
            alignment_plist: UploadFile | None = File(default=None),
        ):
            rate_limit(ctx, "items", user.id, 20, 3600)
            try:
                if type == "haystack":
                    if not private_key_b64:
                        raise ValueError("private key required")
                    keys = provider.toolkit.haystack_from_private_key(private_key_b64)
                    return await _create(
                        db,
                        ctx,
                        user,
                        name,
                        "haystack",
                        {"private_key_b64": keys["private_key_b64"]},
                        {"adv_key_b64": keys["adv_key_b64"]},
                    )
                if plist is None:
                    raise ValueError(".plist file required")
                raw = await plist.read(MAX_UPLOAD + 1)
                align = await alignment_plist.read(MAX_UPLOAD + 1) if alignment_plist else None
                if len(raw) > MAX_UPLOAD or (align and len(align) > MAX_UPLOAD):
                    raise ValueError("file too large")
                parsed = provider.toolkit.airtag_from_plist(raw, align, name)
                return await _create(
                    db,
                    ctx,
                    user,
                    name,
                    "airtag",
                    {"accessory": parsed["accessory"]},
                    {"model": parsed.get("model")},
                )
            except ValueError as e:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None

        @items.post("/generate", status_code=201)
        async def generate_item(data: GenerateIn, user: CurrentUser, ctx: Ctx, db: DB):
            rate_limit(ctx, "items", user.id, 20, 3600)
            keys = provider.toolkit.haystack_generate()
            device = await _create(
                db,
                ctx,
                user,
                data.name,
                "haystack",
                {"private_key_b64": keys["private_key_b64"]},
                {"adv_key_b64": keys["adv_key_b64"]},
            )
            # Only the public advertisement key leaves the server (to flash on the tag).
            return {"device": device, "adv_key_b64": keys["adv_key_b64"]}

        return [self.account_router(), items]
