"""OpenID Connect client for single sign-on (authorization code flow with PKCE)."""

from __future__ import annotations

import base64
import hashlib
import json
import secrets
import time
from typing import Any
from urllib.parse import quote, urlencode

import httpx

from app.config import Settings

METADATA_TTL_S = 3600
# Tolerated clock difference with the provider when checking the ID token expiry.
CLOCK_SKEW_S = 60


class OidcError(Exception):
    """The provider refused the sign-in or answered something unexpected."""


def pkce_pair() -> tuple[str, str]:
    """A PKCE code verifier and its S256 challenge."""
    verifier = secrets.token_urlsafe(48)
    digest = hashlib.sha256(verifier.encode()).digest()
    return verifier, base64.urlsafe_b64encode(digest).rstrip(b"=").decode()


def parse_id_token(
    id_token: str, *, issuer: str, client_id: str, nonce: str, now: float | None = None
) -> dict[str, Any]:
    """Claims of an ID token received straight from the token endpoint.

    The signature is not checked: the token comes over TLS from the issuer's token
    endpoint, in exchange for our code and client secret (OpenID Connect Core 3.1.3.7).
    Issuer, audience, expiry and nonce still are.
    """
    try:
        payload = id_token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except (IndexError, ValueError) as e:
        raise OidcError("malformed id_token") from e
    if not isinstance(claims, dict):
        raise OidcError("malformed id_token")
    if claims.get("iss") != issuer:
        raise OidcError("id_token issuer mismatch")
    aud = claims.get("aud")
    if client_id not in (aud if isinstance(aud, list) else [aud]):
        raise OidcError("id_token audience mismatch")
    exp = claims.get("exp")
    now = time.time() if now is None else now
    if not isinstance(exp, int | float) or exp < now - CLOCK_SKEW_S:
        raise OidcError("id_token expired")
    if not secrets.compare_digest(str(claims.get("nonce", "")), nonce):
        raise OidcError("id_token nonce mismatch")
    if not claims.get("sub"):
        raise OidcError("id_token without subject")
    return claims


class OidcClient:
    def __init__(self, settings: Settings, transport: httpx.AsyncBaseTransport | None = None):
        self.settings = settings
        self.transport = transport  # tests
        self._metadata: dict[str, Any] | None = None
        self._fetched_at = 0.0

    def _http(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=10, transport=self.transport)

    async def metadata(self) -> dict[str, Any]:
        """The provider's discovery document, cached for an hour."""
        if self._metadata and time.monotonic() - self._fetched_at < METADATA_TTL_S:
            return self._metadata
        issuer = (self.settings.oidc_issuer or "").rstrip("/")
        async with self._http() as http:
            r = await http.get(f"{issuer}/.well-known/openid-configuration")
        if r.status_code != 200:
            raise OidcError(f"discovery: HTTP {r.status_code}")
        meta = r.json()
        for key in ("issuer", "authorization_endpoint", "token_endpoint"):
            if not isinstance(meta.get(key), str):
                raise OidcError(f"discovery: no {key}")
        if meta["issuer"].rstrip("/") != issuer:
            raise OidcError(f"discovery: issuer is {meta['issuer']}, expected {issuer}")
        self._metadata, self._fetched_at = meta, time.monotonic()
        return meta

    async def authorization_url(
        self, redirect_uri: str, state: str, nonce: str, challenge: str
    ) -> str:
        meta = await self.metadata()
        params = {
            "response_type": "code",
            "client_id": self.settings.oidc_client_id,
            "redirect_uri": redirect_uri,
            "scope": self.settings.oidc_scopes,
            "state": state,
            "nonce": nonce,
            "code_challenge": challenge,
            "code_challenge_method": "S256",
        }
        endpoint = meta["authorization_endpoint"]
        return f"{endpoint}{'&' if '?' in endpoint else '?'}{urlencode(params)}"

    async def sign_in(
        self, code: str, verifier: str, redirect_uri: str, nonce: str
    ) -> dict[str, Any]:
        """Exchange the code; the user's claims (ID token, completed by userinfo)."""
        meta = await self.metadata()
        client_id = self.settings.oidc_client_id or ""
        secret = self.settings.oidc_client_secret
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri,
            "code_verifier": verifier,
        }
        auth = None
        if secret:
            # client_secret_basic: both parts form-encoded first (RFC 6749 2.3.1).
            auth = (quote(client_id, safe=""), quote(secret, safe=""))
        else:
            data["client_id"] = client_id
        async with self._http() as http:
            r = await http.post(meta["token_endpoint"], data=data, auth=auth)
            if r.status_code != 200:
                raise OidcError(f"token endpoint: HTTP {r.status_code}")
            tokens = r.json()
            if not isinstance(tokens.get("id_token"), str):
                raise OidcError("token endpoint: no id_token")
            claims = parse_id_token(
                tokens["id_token"], issuer=meta["issuer"], client_id=client_id, nonce=nonce
            )
            access_token = tokens.get("access_token")
            if not claims.get("email") and meta.get("userinfo_endpoint") and access_token:
                r = await http.get(
                    meta["userinfo_endpoint"], headers={"Authorization": f"Bearer {access_token}"}
                )
                info = r.json() if r.status_code == 200 else {}
                if info.get("sub") == claims["sub"]:
                    claims = {**info, **claims}
        return claims
