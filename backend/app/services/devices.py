from __future__ import annotations

from datetime import timedelta

from app.context import AppContext
from app.models import Device, DeviceKind, User
from app.schemas import Battery, DeviceOut, FixOut, LostModeOut

SELF_REPORTING = {DeviceKind.BROWSER, DeviceKind.OWNTRACKS}
# A check-in this soon after the fix tells nothing more.
SEEN_AFTER = timedelta(minutes=2)


def fix_out(device: Device) -> FixOut | None:
    if device.last_lat is None or device.last_lon is None or device.last_fix_at is None:
        return None
    # Only a device reporting itself checks in: for iCloud and Find My, last_seen_at is a poll.
    seen = device.last_seen_at if device.kind in SELF_REPORTING else None
    return FixOut(
        lat=device.last_lat,
        lon=device.last_lon,
        accuracy=device.last_accuracy,
        ts=device.last_fix_at,
        seen_at=seen if seen and seen - device.last_fix_at > SEEN_AFTER else None,
    )


def battery_out(device: Device) -> Battery | None:
    if device.battery_level is None and device.battery_label is None:
        return None
    return Battery(
        level=device.battery_level, charging=device.battery_charging, label=device.battery_label
    )


def lost_mode_out(device: Device, owner: User | None = None) -> LostModeOut:
    return LostModeOut(
        enabled=device.lost_enabled,
        message=device.lost_message,
        phone=device.lost_phone,
        since=device.lost_since,
        owner_name=owner.display_name if owner else None,
    )


def is_online(ctx: AppContext, device: Device) -> bool:
    return ctx.hub.device_online(device.id)


def device_out(ctx: AppContext, device: Device, owner: User) -> DeviceOut:
    info: dict = {}
    cfg = device.provider_config or {}
    for key in ("tid", "item_type", "model", "adv_key_b64", "missing_since"):
        if key in cfg:
            info[key] = cfg[key]
    return DeviceOut(
        id=device.id,
        name=device.name,
        kind=device.kind,
        icon=device.icon,
        online=is_online(ctx, device),
        capabilities=ctx.providers.capabilities(device.kind),
        is_primary=owner.primary_device_id == device.id,
        location=fix_out(device),
        last_seen_at=device.last_seen_at,
        battery=battery_out(device),
        lost_mode=lost_mode_out(device, owner),
        created_at=device.created_at,
        provider_info=info,
    )
