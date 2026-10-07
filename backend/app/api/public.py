from fastapi import APIRouter

from app.deps import Ctx

router = APIRouter(tags=["public"])


@router.get("/health")
async def health():
    return {"status": "ok"}


@router.get("/config")
async def config(ctx: Ctx):
    s = ctx.settings
    return {
        "app_name": "Locus",
        "registration_open": s.allow_registration,
        "providers": ctx.providers.kinds(),
        "features": {
            "owntracks": s.feature_owntracks,
            "findmy": s.feature_findmy,
            "icloud": s.feature_icloud,
            "push": ctx.push is not None,
        },
        "map": {
            "tile_url": s.tile_url,
            "tile_url_dark": s.resolved_tile_url_dark,
            "attribution": s.tile_attribution,
        },
        "vapid_public_key": ctx.push.public_key if ctx.push else None,
    }
