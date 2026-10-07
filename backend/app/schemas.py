from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

Locale = Literal["en", "fr"]
DeviceIcon = Literal["phone", "tablet", "laptop", "desktop", "watch", "earbuds", "tag"]


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- auth / users ----------


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=200)
    display_name: str = Field(min_length=1, max_length=80)
    locale: Locale = "en"


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(max_length=200)


class UserOut(ORM):
    id: str
    email: str
    display_name: str
    locale: str
    primary_device_id: str | None
    is_admin: bool


class AuthOut(BaseModel):
    user: UserOut
    token: str | None = None


class MeUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=80)
    locale: Locale | None = None
    primary_device_id: str | None = None


class PublicUser(ORM):
    id: str
    email: str
    display_name: str


# ---------- devices ----------


class DeviceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: Literal["browser", "owntracks"] = "browser"
    icon: DeviceIcon = "phone"


class DeviceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    icon: DeviceIcon | None = None


class Battery(BaseModel):
    level: float | None = None
    charging: bool | None = None
    label: str | None = None


class FixOut(BaseModel):
    lat: float
    lon: float
    accuracy: float | None = None
    ts: datetime


class LostModeOut(BaseModel):
    enabled: bool
    message: str | None = None
    phone: str | None = None
    since: datetime | None = None
    owner_name: str | None = None


class DeviceOut(BaseModel):
    id: str
    name: str
    kind: str
    icon: str
    online: bool
    capabilities: list[str]
    is_primary: bool
    location: FixOut | None
    last_seen_at: datetime | None
    battery: Battery | None
    lost_mode: LostModeOut
    created_at: datetime
    provider_info: dict[str, Any] = {}


class DeviceCreated(BaseModel):
    device: DeviceOut
    device_token: str


class TokenOut(BaseModel):
    device_token: str


class LocationOut(ORM):
    ts: datetime
    lat: float
    lon: float
    accuracy: float | None
    speed: float | None
    battery_level: float | None
    source: str


class HistoryOut(BaseModel):
    device_id: str
    points: list[LocationOut]
    total: int


# ---------- reporting ----------


class FixIn(BaseModel):
    ts: datetime
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    accuracy: float | None = Field(default=None, ge=0, le=1_000_000)
    altitude: float | None = None
    speed: float | None = Field(default=None, ge=0)
    heading: float | None = Field(default=None, ge=0, le=360)

    @field_validator("ts")
    @classmethod
    def _aware(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("timestamp must include a timezone")
        return v


class BatteryIn(BaseModel):
    level: float | None = Field(default=None, ge=0, le=1)
    charging: bool | None = None


class ReportIn(BaseModel):
    fixes: list[FixIn] = Field(default_factory=list, max_length=500)
    battery: BatteryIn | None = None


class ReportOut(BaseModel):
    accepted: int


class CommandOut(ORM):
    id: str
    device_id: str
    type: str
    payload: dict[str, Any]
    status: str
    channel: str | None
    error: str | None
    created_at: datetime
    delivered_at: datetime | None
    acked_at: datetime | None
    expires_at: datetime


class ReportState(BaseModel):
    device: DeviceOut
    lost_mode: LostModeOut
    pending_commands: list[CommandOut]


class CommandIn(BaseModel):
    type: Literal["play_sound", "lost_mode_on", "lost_mode_off"]
    message: str | None = Field(default=None, max_length=200)
    phone: str | None = Field(default=None, max_length=32)


class AckIn(BaseModel):
    status: Literal["acked", "failed"] = "acked"
    error: str | None = Field(default=None, max_length=255)


# ---------- people / sharing ----------


class ShareCreate(BaseModel):
    recipient_email: EmailStr
    expires_at: datetime | None = None


class ShareOut(BaseModel):
    id: str
    owner: PublicUser
    recipient: PublicUser
    status: str
    expires_at: datetime | None
    created_at: datetime
    responded_at: datetime | None


class SharesOut(BaseModel):
    incoming: list[ShareOut]
    outgoing: list[ShareOut]


class PersonOut(BaseModel):
    user: PublicUser
    # share where this person shows me their location
    sharing_with_me: ShareOut | None
    # share where I show this person my location
    i_share_with: ShareOut | None
    location: FixOut | None
    device_name: str | None


# ---------- zones / notifications ----------


class ZoneIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)
    radius_m: float = Field(ge=50, le=50_000)
    notify_enter: bool = True
    notify_exit: bool = True
    device_ids: list[str] | None = None


class ZoneUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    lat: float | None = Field(default=None, ge=-90, le=90)
    lon: float | None = Field(default=None, ge=-180, le=180)
    radius_m: float | None = Field(default=None, ge=50, le=50_000)
    notify_enter: bool | None = None
    notify_exit: bool | None = None
    device_ids: list[str] | None = None


class ZoneOut(ORM):
    id: str
    name: str
    lat: float
    lon: float
    radius_m: float
    notify_enter: bool
    notify_exit: bool
    device_ids: list[str] | None
    created_at: datetime


class ZoneEventOut(BaseModel):
    id: str
    zone_id: str
    zone_name: str
    device_id: str
    device_name: str
    type: str
    ts: datetime
    lat: float
    lon: float


class NotificationOut(ORM):
    id: str
    kind: str
    payload: dict[str, Any]
    created_at: datetime
    read_at: datetime | None


class MarkReadIn(BaseModel):
    ids: list[str] | None = None
    all: bool = False


# ---------- push ----------


class PushKeys(BaseModel):
    p256dh: str = Field(max_length=255)
    auth: str = Field(max_length=255)


class PushSubscriptionIn(BaseModel):
    endpoint: str = Field(max_length=1024)
    keys: PushKeys
    device_id: str | None = None


class PushUnsubscribeIn(BaseModel):
    endpoint: str = Field(max_length=1024)
