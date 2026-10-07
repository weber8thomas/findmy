"""Shared plumbing for providers backed by an Apple account (iCloud, Find My network).

Both are unofficial integrations, disabled by default. The account state (which contains
the Apple ID password) is always stored encrypted with `ctx.box`.
"""

from __future__ import annotations

import asyncio
import logging
import time
from abc import abstractmethod
from datetime import timedelta
from typing import Any, ClassVar, Protocol

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clock import utcnow
from app.config import Settings
from app.deps import DB, Ctx, CurrentUser, rate_limit
from app.models import Device, ProviderAccount, User
from app.providers.base import PollingProvider
from app.services.notify import notify

log = logging.getLogger(__name__)

PENDING_TTL_S = 600
MAX_BACKOFF = timedelta(hours=2)


class AppleAuthError(Exception):
    """Credentials rejected or session expired: the user must sign in again."""


class AppleClient(Protocol):
    async def login(self, username: str, password: str) -> str: ...  # "logged_in" | "require_2fa"
    async def get_2fa_methods(self) -> list[dict[str, str]]: ...
    async def request_2fa(self, method_id: str) -> None: ...
    async def submit_2fa(self, method_id: str, code: str) -> str: ...
    def export_state(self) -> dict[str, Any]: ...
    async def close(self) -> None: ...


class LoginIn(BaseModel):
    apple_id: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=200)


class TwoFactorRequestIn(BaseModel):
    method_id: str = Field(max_length=64)


class TwoFactorSubmitIn(BaseModel):
    method_id: str | None = Field(default=None, max_length=64)
    code: str = Field(min_length=4, max_length=12)


def mask_email(email: str) -> str:
    name, _, domain = email.partition("@")
    return f"{name[:1]}***@{domain}" if domain else f"{email[:1]}***"


class AppleAccountProvider(PollingProvider):
    provider_name: ClassVar[str]
    min_interval_s: ClassVar[int] = 60

    def __init__(self, settings: Settings, interval_s: int):
        super().__init__()
        self.settings = settings
        self.interval_s = max(self.min_interval_s, interval_s)
        # When true, accounts are polled even with no device yet: poll_account adds them itself.
        self.auto_track = False
        self._pending: dict[str, tuple[AppleClient, float]] = {}
        self._clients: dict[str, AppleClient] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    # ----- hooks -----

    @abstractmethod
    def new_client(self, user_id: str, state: dict[str, Any] | None) -> AppleClient: ...

    @abstractmethod
    async def poll_account(
        self, db: AsyncSession, account: ProviderAccount, client: AppleClient, devices: list[Device]
    ) -> None: ...

    # ----- accounts -----

    def lock(self, account_id: str) -> asyncio.Lock:
        return self._locks.setdefault(account_id, asyncio.Lock())

    async def get_account(self, db: AsyncSession, user_id: str) -> ProviderAccount | None:
        return (
            await db.execute(
                select(ProviderAccount).where(
                    ProviderAccount.user_id == user_id,
                    ProviderAccount.provider == self.provider_name,
                )
            )
        ).scalar_one_or_none()

    async def client_for(self, account: ProviderAccount) -> AppleClient:
        client = self._clients.get(account.id)
        if client is None:
            state = self.ctx.box.decrypt_json(account.secret_blob) if account.secret_blob else None
            client = self.new_client(account.user_id, state)
            self._clients[account.id] = client
        return client

    async def drop_client(self, account_id: str) -> None:
        client = self._clients.pop(account_id, None)
        if client is not None:
            try:
                await client.close()
            except Exception:
                log.debug("closing client failed", exc_info=True)

    async def _save_account(
        self, db: AsyncSession, user: User, client: AppleClient, apple_id: str
    ) -> ProviderAccount:
        account = await self.get_account(db, user.id)
        if account is None:
            account = ProviderAccount(user_id=user.id, provider=self.provider_name)
            db.add(account)
        account.state = "logged_in"
        account.display = mask_email(apple_id)
        account.secret_blob = self.ctx.box.encrypt_json(client.export_state())
        account.last_error = None
        account.fail_count = 0
        account.next_poll_at = None
        await db.commit()
        await self.drop_client(account.id)
        self._clients[account.id] = client
        self.wake()
        return account

    async def mark_reauth(self, db: AsyncSession, account: ProviderAccount, error: str) -> None:
        account.state = "reauth_required"
        account.last_error = error[:500]
        await db.commit()
        await self.drop_client(account.id)
        await notify(
            self.ctx,
            db,
            account.user_id,
            "provider_error",
            {"provider": self.provider_name, "error": error[:200]},
            url="/items",
        )

    def _purge_pending(self) -> None:
        now = time.monotonic()
        for uid, (_, exp) in list(self._pending.items()):
            if exp < now:
                self._pending.pop(uid, None)

    # ----- polling -----

    async def poll_once(self) -> None:
        now = utcnow()
        async with self.ctx.sessionmaker() as db:
            accounts = (
                (
                    await db.execute(
                        select(ProviderAccount).where(
                            ProviderAccount.provider == self.provider_name,
                            ProviderAccount.state == "logged_in",
                        )
                    )
                )
                .scalars()
                .all()
            )
            for account in accounts:
                if account.next_poll_at is not None and account.next_poll_at > now:
                    continue
                devices = list(
                    (
                        await db.execute(
                            select(Device).where(
                                Device.owner_id == account.user_id,
                                Device.kind == self.kind,
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                if not devices and not self.auto_track:
                    continue
                await self.poll_one(db, account, devices)

    async def poll_one(
        self, db: AsyncSession, account: ProviderAccount, devices: list[Device]
    ) -> None:
        async with self.lock(account.id):
            try:
                client = await self.client_for(account)
                await self.poll_account(db, account, client, devices)
                account.secret_blob = self.ctx.box.encrypt_json(client.export_state())
                account.last_poll_at = utcnow()
                account.next_poll_at = utcnow() + timedelta(seconds=self.interval_s)
                account.fail_count = 0
                account.last_error = None
                await db.commit()
            except AppleAuthError as e:
                await db.rollback()
                await self.mark_reauth(db, account, str(e) or "authentication required")
            except Exception as e:
                log.exception("%s poll failed for account %s", self.provider_name, account.id)
                await db.rollback()
                account.fail_count += 1
                account.last_error = str(e)[:500]
                backoff = timedelta(seconds=self.interval_s * 2 ** min(account.fail_count, 6))
                account.next_poll_at = utcnow() + min(backoff, MAX_BACKOFF)
                await db.commit()
                await self.drop_client(account.id)

    async def request_refresh(self, device: Device) -> None:
        async with self.ctx.sessionmaker() as db:
            account = await self.get_account(db, device.owner_id)
            if account is None or account.state != "logged_in":
                from app.providers.base import CommandError

                raise CommandError("Apple account not connected")
            account.next_poll_at = None
            await db.commit()
        self.wake()

    # ----- HTTP routes -----

    def account_router(self) -> APIRouter:
        router = APIRouter(prefix=f"/providers/{self.provider_name}", tags=[self.provider_name])
        provider = self

        @router.get("/account")
        async def get_account(user: CurrentUser, db: DB):
            account = await provider.get_account(db, user.id)
            if account is None:
                return {"state": "none", "display": None, "last_poll_at": None, "last_error": None}
            return {
                "state": account.state,
                "display": account.display,
                "last_poll_at": account.last_poll_at,
                "last_error": account.last_error,
            }

        @router.post("/login")
        async def login(data: LoginIn, user: CurrentUser, ctx: Ctx, db: DB):
            rate_limit(ctx, f"{provider.provider_name}-login", user.id, 5, 600)
            provider._purge_pending()
            client = provider.new_client(user.id, None)
            try:
                state = await client.login(data.apple_id.strip(), data.password)
            except AppleAuthError as e:
                await client.close()
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED, str(e) or "Apple sign-in failed"
                ) from None
            except Exception as e:
                await client.close()
                log.exception("apple login failed")
                raise HTTPException(
                    status.HTTP_502_BAD_GATEWAY, f"Apple sign-in failed: {e}"
                ) from None
            if state == "logged_in":
                await provider._save_account(db, user, client, data.apple_id)
                return {"state": "logged_in"}
            methods = await client.get_2fa_methods()
            if methods:
                try:
                    await client.request_2fa(methods[0]["id"])
                except Exception:
                    log.warning("could not request the first 2FA code", exc_info=True)
            provider._pending[user.id] = (client, time.monotonic() + PENDING_TTL_S)
            client.pending_apple_id = data.apple_id  # type: ignore[attr-defined]
            return {"state": "require_2fa", "methods": methods}

        def _pending(user_id: str) -> AppleClient:
            provider._purge_pending()
            entry = provider._pending.get(user_id)
            if entry is None:
                raise HTTPException(status.HTTP_409_CONFLICT, "no sign-in in progress")
            return entry[0]

        @router.post("/2fa/request", status_code=204)
        async def request_2fa(data: TwoFactorRequestIn, user: CurrentUser, ctx: Ctx):
            rate_limit(ctx, f"{provider.provider_name}-2fa", user.id, 10, 600)
            await _pending(user.id).request_2fa(data.method_id)

        @router.post("/2fa/submit")
        async def submit_2fa(data: TwoFactorSubmitIn, user: CurrentUser, ctx: Ctx, db: DB):
            rate_limit(ctx, f"{provider.provider_name}-2fa", user.id, 10, 600)
            client = _pending(user.id)
            try:
                state = await client.submit_2fa(data.method_id or "", data.code.strip())
            except AppleAuthError as e:
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED, str(e) or "invalid code"
                ) from None
            if state != "logged_in":
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid code")
            provider._pending.pop(user.id, None)
            await provider._save_account(db, user, client, client.pending_apple_id)  # type: ignore[attr-defined]
            return {"state": "logged_in"}

        @router.delete("/account", status_code=204)
        async def delete_account(user: CurrentUser, db: DB):
            account = await provider.get_account(db, user.id)
            if account is not None:
                await provider.drop_client(account.id)
                await db.delete(account)
                await db.commit()

        return router
