from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status

from app import access
from app.deps import DB, Ctx, CurrentUser, rate_limit
from app.models import AvatarSource
from app.schemas import MeUpdate, MyLocationOut, ShareOut, SourcesIn, SourcesOut, UserOut
from app.services import avatars, sharing, sources

router = APIRouter(prefix="/me", tags=["me"])


@router.patch("", response_model=UserOut)
async def update_me(data: MeUpdate, user: CurrentUser, ctx: Ctx, db: DB):
    if data.display_name is not None:
        user.display_name = data.display_name.strip()
    if data.locale is not None:
        user.locale = data.locale
    if "primary_device_id" in data.model_fields_set:
        if data.primary_device_id is not None:
            await access.get_owned_device(db, user, data.primary_device_id)
        await sources.set_primary(db, user, data.primary_device_id)
    await db.commit()
    if "primary_device_id" in data.model_fields_set:
        await sources.publish(ctx, db, user)
    return await avatars.user_out(db, user)


@router.put("/avatar", response_model=UserOut)
async def upload_avatar(
    request: Request, user: CurrentUser, ctx: Ctx, db: DB, file: UploadFile = File()
):
    """Set my profile photo (the app sends a small square JPEG). It replaces an SSO one."""
    rate_limit(ctx, "avatar", user.id, 30, 3600)
    # Refuse an oversized body before reading it; the margin covers the multipart framing.
    length = request.headers.get("content-length", "")
    if length.isdigit() and int(length) > avatars.MAX_BYTES + 16_384:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "image too large")
    data = await file.read(avatars.MAX_BYTES + 1)
    await avatars.save(db, user.id, data, AvatarSource.UPLOAD)
    await db.commit()
    return await avatars.user_out(db, user)


@router.delete("/avatar", response_model=UserOut)
async def delete_avatar(user: CurrentUser, db: DB):
    await avatars.remove(db, user.id)
    await db.commit()
    return await avatars.user_out(db, user)


@router.get("/viewers", response_model=list[ShareOut])
async def my_viewers(user: CurrentUser, db: DB):
    """Who can currently see my location."""
    return await sharing.viewers(db, user)


@router.get("/location", response_model=MyLocationOut)
async def my_location(user: CurrentUser, db: DB):
    """Where the people I share with see me: the first fresh source, else the latest."""
    return sources.my_location_out(await sources.resolve(db, user))


@router.get("/sources", response_model=SourcesOut)
async def my_sources(user: CurrentUser, db: DB):
    return SourcesOut(device_ids=await sources.source_ids(db, user))


@router.put("/sources", response_model=SourcesOut)
async def set_my_sources(data: SourcesIn, user: CurrentUser, ctx: Ctx, db: DB):
    """Order the devices my location is taken from; the first one becomes the primary device."""
    await sources.save(db, user, data.device_ids)
    await db.commit()
    await sources.publish(ctx, db, user)
    return SourcesOut(device_ids=await sources.source_ids(db, user))
