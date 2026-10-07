from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import (
    JSON,
    Boolean,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.clock import utcnow
from app.db import Base, UTCDateTime


def new_id() -> str:
    return uuid.uuid4().hex


class DeviceKind(StrEnum):
    BROWSER = "browser"
    OWNTRACKS = "owntracks"
    FINDMY = "findmy"
    ICLOUD = "icloud"


class ShareStatus(StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    REVOKED = "revoked"
    EXPIRED = "expired"


class CommandType(StrEnum):
    PLAY_SOUND = "play_sound"
    LOST_MODE_ON = "lost_mode_on"
    LOST_MODE_OFF = "lost_mode_off"


class CommandStatus(StrEnum):
    PENDING = "pending"
    DELIVERED = "delivered"
    ACKED = "acked"
    FAILED = "failed"
    EXPIRED = "expired"


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(254), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(80))
    password_hash: Mapped[str] = mapped_column(String(255))
    locale: Mapped[str] = mapped_column(String(5), default="en")
    primary_device_id: Mapped[str | None] = mapped_column(
        String(32), ForeignKey("devices.id", ondelete="SET NULL", use_alter=True), nullable=True
    )
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class AvatarSource(StrEnum):
    UPLOAD = "upload"
    SSO = "sso"


class UserAvatar(Base):
    """A user's profile photo, uploaded or taken from the SSO provider (a table of its own:
    the schema is only ever created, never migrated)."""

    __tablename__ = "user_avatars"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    content_type: Mapped[str] = mapped_column(String(32))
    data: Mapped[bytes] = mapped_column(LargeBinary)
    source: Mapped[str] = mapped_column(String(8))
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class OidcIdentity(Base):
    """An account at the SSO provider (issuer + subject) linked to a user."""

    __tablename__ = "oidc_identities"
    __table_args__ = (UniqueConstraint("issuer", "subject"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    issuer: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_used_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(16), default=DeviceKind.BROWSER)
    icon: Mapped[str] = mapped_column(String(16), default="phone")
    token_hash: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    provider_config: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    secret_blob: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)

    last_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_fix_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    last_seen_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    battery_level: Mapped[float | None] = mapped_column(Float, nullable=True)
    battery_charging: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    battery_label: Mapped[str | None] = mapped_column(String(16), nullable=True)

    lost_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    lost_message: Mapped[str | None] = mapped_column(String(200), nullable=True)
    lost_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    lost_since: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)

    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class LocationSource(Base):
    """One of a user's own devices their location is taken from, by priority (rank 0 first;
    see services/sources). A table of its own: the schema is only ever created, never migrated.
    Without rows, the primary device alone is the source."""

    __tablename__ = "location_sources"

    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    device_id: Mapped[str] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True
    )
    rank: Mapped[int] = mapped_column(Integer)


class Location(Base):
    __tablename__ = "locations"
    __table_args__ = (
        UniqueConstraint("device_id", "ts", name="uq_location_device_ts"),
        Index("ix_locations_device_ts", "device_id", "ts"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"))
    ts: Mapped[datetime] = mapped_column(UTCDateTime)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    altitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    speed: Mapped[float | None] = mapped_column(Float, nullable=True)
    heading: Mapped[float | None] = mapped_column(Float, nullable=True)
    battery_level: Mapped[float | None] = mapped_column(Float, nullable=True)
    source: Mapped[str] = mapped_column(String(16))
    received_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class Share(Base):
    """`owner` shares their location with `recipient`."""

    __tablename__ = "shares"
    __table_args__ = (
        Index(
            "uq_share_active",
            "owner_id",
            "recipient_id",
            unique=True,
            sqlite_where=text("status IN ('pending', 'accepted')"),
        ),
    )

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    recipient_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[str] = mapped_column(String(16), default=ShareStatus.PENDING)
    expires_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    responded_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class Zone(Base):
    __tablename__ = "zones"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    owner_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)
    radius_m: Mapped[float] = mapped_column(Float)
    notify_enter: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_exit: Mapped[bool] = mapped_column(Boolean, default=True)
    # None = every device the zone owner can see (own devices + people sharing with them).
    device_ids: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class ZoneState(Base):
    __tablename__ = "zone_states"

    zone_id: Mapped[str] = mapped_column(
        ForeignKey("zones.id", ondelete="CASCADE"), primary_key=True
    )
    device_id: Mapped[str] = mapped_column(
        ForeignKey("devices.id", ondelete="CASCADE"), primary_key=True
    )
    state: Mapped[str] = mapped_column(String(8), default="unknown")
    pending_state: Mapped[str | None] = mapped_column(String(8), nullable=True)
    pending_count: Mapped[int] = mapped_column(Integer, default=0)
    changed_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class ZoneEvent(Base):
    __tablename__ = "zone_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    zone_id: Mapped[str] = mapped_column(ForeignKey("zones.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(8))
    ts: Mapped[datetime] = mapped_column(UTCDateTime)
    lat: Mapped[float] = mapped_column(Float)
    lon: Mapped[float] = mapped_column(Float)


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    read_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[str | None] = mapped_column(
        ForeignKey("devices.id", ondelete="SET NULL"), nullable=True, index=True
    )
    endpoint: Mapped[str] = mapped_column(String(1024), unique=True)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    user_agent: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    last_success_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    failure_count: Mapped[int] = mapped_column(Integer, default=0)


class Command(Base):
    __tablename__ = "commands"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    device_id: Mapped[str] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    issued_by: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(16))
    payload: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(16), default=CommandStatus.PENDING)
    channel: Mapped[str | None] = mapped_column(String(8), nullable=True)
    error: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    delivered_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    acked_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    expires_at: Mapped[datetime] = mapped_column(UTCDateTime)


class ProviderAccount(Base):
    __tablename__ = "provider_accounts"
    __table_args__ = (UniqueConstraint("user_id", "provider", name="uq_provider_account_user"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(16))
    state: Mapped[str] = mapped_column(String(24), default="logged_in")
    display: Mapped[str] = mapped_column(String(254))
    secret_blob: Mapped[bytes | None] = mapped_column(LargeBinary, nullable=True)
    last_poll_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    next_poll_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    fail_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
