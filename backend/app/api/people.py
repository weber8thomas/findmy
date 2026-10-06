from fastapi import APIRouter

from app.deps import DB, Ctx, CurrentUser, rate_limit
from app.schemas import PersonOut, ShareCreate, ShareOut, SharesOut
from app.services import sharing

router = APIRouter(tags=["people"])


@router.get("/people", response_model=list[PersonOut])
async def people(user: CurrentUser, db: DB):
    return await sharing.people(db, user)


@router.get("/shares", response_model=SharesOut)
async def list_shares(user: CurrentUser, db: DB):
    return await sharing.list_shares(db, user)


@router.post("/shares", response_model=ShareOut, status_code=201)
async def create_share(data: ShareCreate, user: CurrentUser, ctx: Ctx, db: DB):
    rate_limit(ctx, "invite", user.id, 20, 3600)
    share = await sharing.create(ctx, db, user, str(data.recipient_email), data.expires_at)
    return await sharing.share_out(db, share)


@router.post("/shares/{share_id}/accept", response_model=ShareOut)
async def accept_share(share_id: str, user: CurrentUser, ctx: Ctx, db: DB):
    share = await sharing.respond(ctx, db, user, share_id, accept=True)
    return await sharing.share_out(db, share)


@router.post("/shares/{share_id}/decline", response_model=ShareOut)
async def decline_share(share_id: str, user: CurrentUser, ctx: Ctx, db: DB):
    share = await sharing.respond(ctx, db, user, share_id, accept=False)
    return await sharing.share_out(db, share)


@router.delete("/shares/{share_id}", response_model=ShareOut)
async def stop_share(share_id: str, user: CurrentUser, ctx: Ctx, db: DB):
    """Owner: stop sharing my location. Recipient: stop following this person."""
    share = await sharing.stop(ctx, db, user, share_id)
    return await sharing.share_out(db, share)
