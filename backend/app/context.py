from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from sqlalchemy.ext.asyncio import AsyncEngine, async_sessionmaker

from app.config import Settings
from app.crypto import SecretBox
from app.ratelimit import RateLimiter
from app.realtime.hub import Hub

if TYPE_CHECKING:
    from app.providers.base import ProviderRegistry
    from app.services.push import PushService


@dataclass
class AppContext:
    """Process-wide services, stored on `app.state.ctx`."""

    settings: Settings
    engine: AsyncEngine
    sessionmaker: async_sessionmaker
    hub: Hub
    limiter: RateLimiter
    box: SecretBox
    providers: ProviderRegistry = None  # type: ignore[assignment]
    push: PushService = None  # type: ignore[assignment]
    extras: dict[str, Any] = field(default_factory=dict)
