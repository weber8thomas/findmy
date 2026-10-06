from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import delete, select, update

from app import access
from app.clock import utcnow
from app.deps import DB, CurrentUser
from app.models import Notification, Zone, ZoneState
from app.schemas import MarkReadIn, NotificationOut, ZoneEventOut, ZoneIn, ZoneOut, ZoneUpdate
from app.services import zones as zones_service

router = APIRouter(tags=["zones"])


async def _check_devices(db, user, device_ids: list[str] | None) -> None:
    if device_ids is None:
        return
    visible = await zones_service.visible_device_ids(db, user)
    if not set(device_ids) <= visible:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "unknown device in device_ids")


async def _get_zone(db, user, zone_id: str) -> Zone:
    zone = await db.get(Zone, zone_id)
    if zone is None or zone.owner_id != user.id:
        raise access.not_found()
    return zone


@router.get("/zones", response_model=list[ZoneOut])
async def list_zones(user: CurrentUser, db: DB):
    rows = await db.execute(select(Zone).where(Zone.owner_id == user.id).order_by(Zone.name))
    return list(rows.scalars().all())


@router.post("/zones", response_model=ZoneOut, status_code=201)
async def create_zone(data: ZoneIn, user: CurrentUser, db: DB):
    await _check_devices(db, user, data.device_ids)
    zone = Zone(owner_id=user.id, **data.model_dump())
    zone.name = zone.name.strip()
    db.add(zone)
    await db.commit()
    return zone


@router.get("/zones/events", response_model=list[ZoneEventOut])
async def zone_events(user: CurrentUser, db: DB, limit: int = Query(default=50, ge=1, le=500)):
    return await zones_service.list_events(db, user, limit)


@router.patch("/zones/{zone_id}", response_model=ZoneOut)
async def update_zone(zone_id: str, data: ZoneUpdate, user: CurrentUser, db: DB):
    zone = await _get_zone(db, user, zone_id)
    changes = data.model_dump(exclude_unset=True)
    if "device_ids" in changes:
        await _check_devices(db, user, changes["device_ids"])
    geometry_changed = any(k in changes for k in ("lat", "lon", "radius_m"))
    for k, v in changes.items():
        setattr(zone, k, v.strip() if k == "name" and v else v)
    if geometry_changed:
        # Re-establish the baseline so moving a zone doesn't fire spurious alerts.
        await db.execute(delete(ZoneState).where(ZoneState.zone_id == zone.id))
    await db.commit()
    return zone


@router.delete("/zones/{zone_id}", status_code=204)
async def delete_zone(zone_id: str, user: CurrentUser, db: DB):
    zone = await _get_zone(db, user, zone_id)
    await db.delete(zone)
    await db.commit()


@router.get("/notifications", response_model=list[NotificationOut])
async def list_notifications(
    user: CurrentUser,
    db: DB,
    unread: bool = False,
    limit: int = Query(default=50, ge=1, le=200),
):
    q = select(Notification).where(Notification.user_id == user.id)
    if unread:
        q = q.where(Notification.read_at.is_(None))
    rows = await db.execute(q.order_by(Notification.created_at.desc()).limit(limit))
    return list(rows.scalars().all())


@router.post("/notifications/read", status_code=204)
async def mark_read(data: MarkReadIn, user: CurrentUser, db: DB):
    q = update(Notification).where(Notification.user_id == user.id, Notification.read_at.is_(None))
    if not data.all:
        q = q.where(Notification.id.in_(data.ids or []))
    await db.execute(q.values(read_at=utcnow()))
    await db.commit()
