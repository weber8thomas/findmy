from fastapi import APIRouter, File, HTTPException, Request, UploadFile, status

from app import access
from app.deps import DB, Ctx, CurrentUser, rate_limit
from app.models import AvatarSource
from app.schemas import MeUpdate, ShareOut, UserOut
from app.services import avatars, sharing

router = APIRouter(prefix="/me", tags=["me"])


@router.patch("", response_model=UserOut)
async def update_me(data: MeUpdate, user: CurrentUser, db: DB):
    if data.display_name is not None:
        user.display_name = data.display_name.strip()
    if data.locale is not None:
        user.locale = data.locale
    if "primary_device_id" in data.model_fields_set:
        if data.primary_device_id is not None:
            await access.get_owned_device(db, user, data.primary_device_id)
        user.primary_device_id = data.primary_device_id
    await db.commit()
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
