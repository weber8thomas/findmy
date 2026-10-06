from __future__ import annotations

from collections.abc import AsyncIterator
from datetime import timedelta
from typing import Annotated
from urllib.parse import urlparse

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import HTTPConnection

from app.clock import utcnow
from app.context import AppContext
from app.models import Device, Session, User
from app.security import DEVICE_TOKEN_PREFIX, hash_token

SESSION_COOKIE = "locus_session"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def get_ctx(conn: HTTPConnection) -> AppContext:
    return conn.app.state.ctx


Ctx = Annotated[AppContext, Depends(get_ctx)]


async def get_db(ctx: Ctx) -> AsyncIterator[AsyncSession]:
    async with ctx.sessionmaker() as db:
        yield db


DB = Annotated[AsyncSession, Depends(get_db)]


def client_ip(conn: HTTPConnection, ctx: AppContext) -> str:
    if ctx.settings.trust_proxy:
        fwd = conn.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
    return conn.client.host if conn.client else "unknown"


def origin_allowed(conn: HTTPConnection, ctx: AppContext) -> bool:
    """CSRF / cross-site WebSocket protection for cookie-authenticated requests."""
    origin = conn.headers.get("origin")
    if origin is None:
        referer = conn.headers.get("referer")
        if referer is None:
            return True  # non-browser client
        u = urlparse(referer)
        origin = f"{u.scheme}://{u.netloc}"
    if ctx.settings.base_origin and origin == ctx.settings.base_origin:
        return True
    host = conn.headers.get("host")
    if ctx.settings.trust_proxy:
        host = conn.headers.get("x-forwarded-host", host)
    return urlparse(origin).netloc == host


def bearer_token(conn: HTTPConnection) -> str | None:
    auth = conn.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    if scheme.lower() == "bearer" and token:
        return token.strip()
    return None


async def session_user(conn: HTTPConnection, db: AsyncSession) -> tuple[User, Session] | None:
    """Resolve the user from the session cookie or a bearer session token."""
    token = bearer_token(conn)
    via_cookie = False
    if token is None or token.startswith(DEVICE_TOKEN_PREFIX):
        token = conn.cookies.get(SESSION_COOKIE)
        via_cookie = True
    if not token:
        return None
    now = utcnow()
    row = (
        await db.execute(
            select(Session, User)
            .join(User, User.id == Session.user_id)
            .where(Session.token_hash == hash_token(token))
        )
    ).first()
    if row is None:
        return None
    sess, user = row
    if sess.expires_at <= now:
        await db.delete(sess)
        await db.commit()
        return None
    ctx = get_ctx(conn)
    unsafe = conn.scope["type"] == "http" and conn.scope["method"] not in SAFE_METHODS
    if via_cookie and unsafe and not origin_allowed(conn, ctx):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "origin not allowed")
    if now - sess.last_used_at > timedelta(minutes=5):
        sess.last_used_at = now
        sess.expires_at = now + timedelta(days=ctx.settings.session_days)
        await db.commit()
    return user, sess


async def current_session(request: Request, db: DB) -> tuple[User, Session]:
    found = await session_user(request, db)
    if found is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    return found


async def current_user(found: Annotated[tuple[User, Session], Depends(current_session)]) -> User:
    return found[0]


CurrentUser = Annotated[User, Depends(current_user)]


async def device_from_token(token: str | None, db: AsyncSession) -> Device | None:
    if not token or not token.startswith(DEVICE_TOKEN_PREFIX):
        return None
    return (
        await db.execute(select(Device).where(Device.token_hash == hash_token(token)))
    ).scalar_one_or_none()


async def current_device(request: Request, db: DB) -> Device:
    device = await device_from_token(bearer_token(request), db)
    if device is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid device token")
    return device


ReportingDevice = Annotated[Device, Depends(current_device)]


def rate_limit(ctx: AppContext, bucket: str, key: str, limit: int, window_s: float) -> None:
    if not ctx.limiter.hit(bucket, key, limit, window_s):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "too many requests")
