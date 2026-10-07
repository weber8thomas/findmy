from fastapi import APIRouter

from app import version
from app.deps import Ctx

router = APIRouter(tags=["public"])


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/config")
async def config(ctx: Ctx):
    s = ctx.settings
    return {
        "app_name": "Oukilé",
        "version": version.VERSION,
        "revision": version.REVISION,
        "registration_open": s.allow_registration,
        "default_locale": s.default_locale,
        "auth": {
            "password": s.password_login,
            "oidc": {"name": s.oidc_name, "login_url": "/api/auth/oidc/login"}
            if s.oidc_enabled
            else None,
        },
        "providers": ctx.providers.kinds(),
        "features": {
            "owntracks": s.feature_owntracks,
            "findmy": s.feature_findmy,
            "icloud": s.feature_icloud,
            "push": ctx.push is not None,
            "geocode": s.geocoder_host is not None,
        },
        # For the privacy page: where typed addresses are sent (None: address search is off).
        "geocoder_host": s.geocoder_host,
        # For the privacy page: how long the position history is kept.
        "retention_days": s.location_retention_days,
        "map": {
            "tile_url": s.tile_url,
            "tile_url_dark": s.resolved_tile_url_dark,
            "attribution": s.tile_attribution,
        },
        "vapid_public_key": ctx.push.public_key if ctx.push else None,
    }
