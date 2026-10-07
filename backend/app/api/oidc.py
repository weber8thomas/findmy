"""Single sign-on with an OpenID Connect provider (e.g. Authentik).

/login redirects to the provider; it sends the browser back to /callback with a code,
exchanged for the user's identity, then a normal session cookie is set. State, nonce
and PKCE verifier travel in a short-lived encrypted cookie, scoped to these two URLs.
"""

from __future__ import annotations

import logging
import secrets
from typing import Any

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.auth import _start_session
from app.context import AppContext
from app.crypto import InvalidToken, SecretBox
from app.deps import DB, Ctx, client_ip, rate_limit
from app.models import OidcIdentity, User
from app.security import hash_password
from app.services.oidc import OidcClient, OidcError, pkce_pair

log = logging.getLogger(__name__)

router = APIRouter(prefix="/auth/oidc", tags=["auth"])

STATE_COOKIE = "oukile_oidc"
STATE_PATH = "/api/auth/oidc"
STATE_TTL_S = 600


def _box(ctx: AppContext) -> SecretBox:
    return SecretBox(ctx.settings.secret_key or "", b"oukile/oidc-state/v1")


def _redirect_uri(request: Request, ctx: AppContext) -> str:
    if ctx.settings.base_url:
        return ctx.settings.base_url.rstrip("/") + "/api/auth/oidc/callback"
    return str(request.url_for("oidc_callback"))


def _fail(code: str) -> RedirectResponse:
    """Back to the sign-in page, which explains `code` (denied, failed, no_account, disabled)."""
    response = RedirectResponse(f"/login?sso_error={code}", status_code=303)
    response.delete_cookie(STATE_COOKIE, path=STATE_PATH)
    return response


def _read_state(request: Request, ctx: AppContext) -> dict[str, str] | None:
    raw = request.cookies.get(STATE_COOKIE)
    if not raw:
        return None
    try:
        return _box(ctx).decrypt_json(raw.encode(), ttl=STATE_TTL_S)
    except (InvalidToken, ValueError):
        return None


def _locale(request: Request) -> str:
    return "fr" if request.headers.get("accept-language", "").lower().startswith("fr") else "en"


def _display_name(claims: dict[str, Any], email: str) -> str:
    for key in ("name", "preferred_username"):
        value = claims.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()[:80]
    return email.split("@")[0][:80]


async def _find_or_create_user(
    request: Request, ctx: AppContext, db, claims: dict[str, Any]
) -> User | None:
    """The user linked to this identity, else the one with its email, else a new one."""
    issuer, subject = claims["iss"], str(claims["sub"])
    identity = (
        await db.execute(
            select(OidcIdentity).where(
                OidcIdentity.issuer == issuer, OidcIdentity.subject == subject
            )
        )
    ).scalar_one_or_none()
    if identity is not None:
        return await db.get(User, identity.user_id)

    email = claims.get("email")
    email = email.strip().lower() if isinstance(email, str) and "@" in email else None
    if email is None:
        log.warning("SSO sign-in without an email address (subject %s)", subject)
        return None
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if user is not None:
        linked = (
            await db.execute(
                select(OidcIdentity.id).where(
                    OidcIdentity.user_id == user.id, OidcIdentity.issuer == issuer
                )
            )
        ).first()
        if linked is not None:
            # Another account at the provider claims the same email: keep the first one.
            log.warning("SSO subject %s has the email of a user linked to another one", subject)
            return None
    else:
        s = ctx.settings
        count = (await db.execute(select(func.count()).select_from(User))).scalar_one()
        allowed = s.oidc_registration if s.oidc_registration is not None else s.allow_registration
        if count > 0 and not allowed:
            return None
        user = User(
            email=email,
            display_name=_display_name(claims, email),
            # Unknown to anyone: the account signs in through SSO only.
            password_hash=hash_password(secrets.token_urlsafe(32)),
            locale=_locale(request),
            is_admin=count == 0,
        )
        db.add(user)
        await db.flush()
    db.add(OidcIdentity(user_id=user.id, issuer=issuer, subject=subject))
    await db.flush()
    return user


@router.get("/login")
async def oidc_login(request: Request, ctx: Ctx):
    client: OidcClient | None = ctx.extras.get("oidc")
    if client is None:
        return _fail("disabled")
    rate_limit(ctx, "oidc-ip", client_ip(request, ctx), 30, 60)
    verifier, challenge = pkce_pair()
    state = {
        "state": secrets.token_urlsafe(24),
        "nonce": secrets.token_urlsafe(24),
        "verifier": verifier,
        "redirect_uri": _redirect_uri(request, ctx),
    }
    try:
        url = await client.authorization_url(
            state["redirect_uri"], state["state"], state["nonce"], challenge
        )
    except (OidcError, httpx.HTTPError, ValueError) as e:
        log.warning("SSO provider unreachable: %s", e)
        return _fail("failed")
    response = RedirectResponse(url, status_code=302)
    response.set_cookie(
        STATE_COOKIE,
        _box(ctx).encrypt_json(state).decode(),
        max_age=STATE_TTL_S,
        httponly=True,
        samesite="lax",
        secure=ctx.settings.cookie_secure,
        path=STATE_PATH,
    )
    return response


@router.get("/callback", name="oidc_callback")
async def oidc_callback(
    request: Request,
    ctx: Ctx,
    db: DB,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    client: OidcClient | None = ctx.extras.get("oidc")
    if client is None:
        return _fail("disabled")
    rate_limit(ctx, "oidc-ip", client_ip(request, ctx), 30, 60)
    if error:
        return _fail("denied" if error == "access_denied" else "failed")
    saved = _read_state(request, ctx)
    if saved is None or not code or not state or not secrets.compare_digest(state, saved["state"]):
        return _fail("failed")
    try:
        claims = await client.sign_in(
            code, saved["verifier"], saved["redirect_uri"], saved["nonce"]
        )
    except (OidcError, httpx.HTTPError, ValueError) as e:
        log.warning("SSO sign-in failed: %s", e)
        return _fail("failed")
    try:
        user = await _find_or_create_user(request, ctx, db, claims)
    except IntegrityError:  # the same first sign-in, twice at once
        await db.rollback()
        return _fail("failed")
    if user is None:
        return _fail("no_account")
    response = RedirectResponse("/", status_code=303)
    await _start_session(request, response, ctx, db, user, bearer=False)
    response.delete_cookie(STATE_COOKIE, path=STATE_PATH)
    return response
