from fastapi import APIRouter

from app import access
from app.deps import DB, CurrentUser
from app.schemas import MeUpdate, ShareOut, UserOut
from app.services import sharing

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
    return user


@router.get("/viewers", response_model=list[ShareOut])
async def my_viewers(user: CurrentUser, db: DB):
    """Who can currently see my location."""
    return await sharing.viewers(db, user)
