from __future__ import annotations

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.clock import utcnow
from app.context import AppContext
from app.deps import DB, SESSION_COOKIE, Ctx, CurrentUser, client_ip, current_session, rate_limit
from app.models import Session, User
from app.schemas import AuthOut, LoginIn, RegisterIn, UserOut
from app.security import (
    DUMMY_PASSWORD_HASH,
    hash_password,
    hash_token,
    new_session_token,
    verify_password,
)
from app.services import avatars

router = APIRouter(prefix="/auth", tags=["auth"])


def _require_password_login(ctx: AppContext) -> None:
    if not ctx.settings.password_login:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "password sign-in is disabled, use SSO")


def _set_cookie(response: Response, ctx: AppContext, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=ctx.settings.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=ctx.settings.cookie_secure,
        path="/",
    )


async def _start_session(
    request: Request, response: Response, ctx: AppContext, db, user: User, bearer: bool
) -> AuthOut:
    token = new_session_token()
    now = utcnow()
    db.add(
        Session(
            user_id=user.id,
            token_hash=hash_token(token),
            user_agent=(request.headers.get("user-agent") or "")[:255],
            created_at=now,
            last_used_at=now,
            expires_at=now + timedelta(days=ctx.settings.session_days),
        )
    )
    await db.commit()
    _set_cookie(response, ctx, token)
    return AuthOut(user=await avatars.user_out(db, user), token=token if bearer else None)


@router.post("/register", response_model=AuthOut, status_code=201)
async def register(
    data: RegisterIn, request: Request, response: Response, ctx: Ctx, db: DB, bearer: bool = False
):
    _require_password_login(ctx)
    rate_limit(ctx, "register", client_ip(request, ctx), 10, 3600)
    count = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    if count > 0 and not ctx.settings.allow_registration:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "registration is closed")
    user = User(
        email=data.email.lower(),
        display_name=data.display_name.strip(),
        password_hash=hash_password(data.password),
        locale=data.locale,
        is_admin=count == 0,
    )
    db.add(user)
    try:
        await db.flush()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered") from None
    return await _start_session(request, response, ctx, db, user, bearer)


@router.post("/login", response_model=AuthOut)
async def login(
    data: LoginIn, request: Request, response: Response, ctx: Ctx, db: DB, bearer: bool = False
):
    _require_password_login(ctx)
    email = data.email.lower()
    rate_limit(ctx, "login-ip", client_ip(request, ctx), 20, 60)
    rate_limit(ctx, "login-email", email, 10, 900)
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is None:
        verify_password(DUMMY_PASSWORD_HASH, data.password)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    if not verify_password(user.password_hash, data.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    return await _start_session(request, response, ctx, db, user, bearer)


@router.post("/logout", status_code=204)
async def logout(
    response: Response, db: DB, found: Annotated[tuple[User, Session], Depends(current_session)]
):
    await db.delete(found[1])
    await db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser, db: DB):
    return await avatars.user_out(db, user)
