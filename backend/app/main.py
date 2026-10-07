from __future__ import annotations

import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import APIRouter, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse

from app.api import auth, devices, me, people, public, push, report, zones
from app.config import Settings, bootstrap
from app.context import AppContext
from app.crypto import SecretBox
from app.db import create_schema, make_engine, make_sessionmaker
from app.providers.base import Provider, ProviderRegistry
from app.providers.browser import BrowserProvider
from app.ratelimit import RateLimiter
from app.realtime import ws
from app.realtime.hub import Hub
from app.services import housekeeping
from app.services.push import PushService

log = logging.getLogger("locus")
# uvicorn only configures its own loggers; without this the app's INFO logs are dropped.
logging.basicConfig(level=logging.INFO, format="%(levelname)s:     %(name)s - %(message)s")


def build_providers(settings: Settings) -> list[Provider]:
    providers: list[Provider] = [BrowserProvider()]
    if settings.feature_owntracks:
        from app.providers.owntracks import OwnTracksProvider

        providers.append(OwnTracksProvider())
    if settings.feature_findmy:
        from app.providers.findmy.provider import FindMyProvider

        providers.append(FindMyProvider(settings))
    if settings.feature_icloud:
        from app.providers.icloud.provider import ICloudProvider

        providers.append(ICloudProvider(settings))
    return providers


def _tile_source(url: str) -> str:
    tile = urlparse(url.replace("{s}", "a"))
    if not tile.netloc:
        return ""
    if "{s}" in url:
        return f"{tile.scheme}://*.{tile.netloc.split('.', 1)[-1]}"
    return f"{tile.scheme}://{tile.netloc}"


def _csp(request: Request, settings: Settings) -> str:
    sources = {_tile_source(settings.tile_url), _tile_source(settings.resolved_tile_url_dark)}
    tile_host = " ".join(sorted(s for s in sources if s))
    host = request.headers.get("host", "")
    return "; ".join(
        [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline'",
            f"img-src 'self' data: blob: {tile_host}".strip(),
            # Vector basemaps (MapLibre) fetch their style, tiles, fonts and sprites.
            f"connect-src 'self' ws://{host} wss://{host} {tile_host}".strip(),
            "worker-src 'self'",
            "manifest-src 'self'",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ]
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = bootstrap(settings or Settings())
    engine = make_engine(settings.resolved_database_url)
    ctx = AppContext(
        settings=settings,
        engine=engine,
        sessionmaker=make_sessionmaker(engine),
        hub=Hub(),
        limiter=RateLimiter(settings.rate_limit_enabled),
        box=SecretBox(settings.secret_key or ""),
    )
    ctx.providers = ProviderRegistry(build_providers(settings))
    try:
        ctx.push = PushService(settings)
    except Exception:  # pragma: no cover - only if key generation fails
        log.exception("web push disabled")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await create_schema(engine)
        await ctx.providers.start(ctx)
        hk = asyncio.create_task(housekeeping.loop(ctx), name="housekeeping")
        try:
            yield
        finally:
            hk.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await hk
            ctx.hub.close_all()
            await ctx.providers.stop()
            await ctx.drain()
            await engine.dispose()

    app = FastAPI(
        title="Oukilé", lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json"
    )
    app.state.ctx = ctx

    api = APIRouter(prefix="/api")
    for module in (public, auth, me, devices, report, people, zones, push):
        api.include_router(module.router)
    for provider in ctx.providers.all():
        for r in provider.routers():
            api.include_router(r)
    api.include_router(ws.router)
    app.include_router(api)

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        h.setdefault("Permissions-Policy", "geolocation=(self), camera=(), microphone=()")
        if not request.url.path.startswith("/api/"):
            h.setdefault("Content-Security-Policy", _csp(request, settings))
            h.setdefault("X-Frame-Options", "DENY")
        else:
            h.setdefault("Cache-Control", "no-store")
        return response

    static_dir = settings.static_dir
    if static_dir and Path(static_dir).is_dir():
        root = Path(static_dir).resolve()
        index = root / "index.html"
        no_cache = {"index.html", "sw.js", "manifest.webmanifest"}

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            if path.startswith("api/"):
                raise HTTPException(404)
            target = (root / path).resolve()
            if path and target.is_file() and target.is_relative_to(root):
                headers = {}
                if target.name in no_cache:
                    headers["Cache-Control"] = "no-cache"
                elif "/assets/" in f"/{path}":
                    headers["Cache-Control"] = "public, max-age=31536000, immutable"
                return FileResponse(target, headers=headers)
            return FileResponse(index, headers={"Cache-Control": "no-cache"})

    return app
