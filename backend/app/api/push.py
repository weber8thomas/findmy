from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import delete, select

from app import access
from app.deps import DB, Ctx, CurrentUser, rate_limit
from app.models import PushSubscription
from app.schemas import PushSubscriptionIn, PushUnsubscribeIn

router = APIRouter(prefix="/push", tags=["push"])


def _require_push(ctx) -> None:
    if ctx.push is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "push disabled")


@router.get("/vapid-key")
async def vapid_key(ctx: Ctx):
    _require_push(ctx)
    return {"public_key": ctx.push.public_key}


@router.post("/subscriptions", status_code=201)
async def subscribe(
    data: PushSubscriptionIn, request: Request, user: CurrentUser, ctx: Ctx, db: DB
):
    _require_push(ctx)
    if not data.endpoint.startswith("https://"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "endpoint must be https")
    if data.device_id is not None:
        await access.get_owned_device(db, user, data.device_id)
    sub = (
        await db.execute(select(PushSubscription).where(PushSubscription.endpoint == data.endpoint))
    ).scalar_one_or_none()
    if sub is None:
        sub = PushSubscription(endpoint=data.endpoint)
        db.add(sub)
    sub.user_id = user.id
    sub.device_id = data.device_id
    sub.p256dh = data.keys.p256dh
    sub.auth = data.keys.auth
    sub.user_agent = (request.headers.get("user-agent") or "")[:255]
    sub.failure_count = 0
    await db.commit()
    return {"id": sub.id}


@router.delete("/subscriptions", status_code=204)
async def unsubscribe(data: PushUnsubscribeIn, user: CurrentUser, db: DB):
    await db.execute(
        delete(PushSubscription).where(
            PushSubscription.endpoint == data.endpoint, PushSubscription.user_id == user.id
        )
    )
    await db.commit()


@router.post("/test")
async def test_push(user: CurrentUser, ctx: Ctx, db: DB):
    _require_push(ctx)
    rate_limit(ctx, "push-test", user.id, 5, 60)
    title = "Locus"
    body = "Les notifications fonctionnent." if user.locale == "fr" else "Notifications work."
    sent = await ctx.push.send_to_user(
        db, user.id, {"kind": "test", "title": title, "body": body, "tag": "test", "url": "/me"}
    )
    return {"sent": sent}
