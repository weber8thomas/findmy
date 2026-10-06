from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.context import AppContext
from app.i18n import t
from app.models import Notification, User
from app.schemas import NotificationOut

log = logging.getLogger(__name__)


async def notify(
    ctx: AppContext,
    db: AsyncSession,
    user_id: str,
    kind: str,
    payload: dict[str, Any],
    *,
    url: str = "/",
    push: bool = True,
) -> Notification:
    """In-app inbox entry + live WebSocket event + Web Push (localised to the recipient)."""
    user = await db.get(User, user_id)
    locale = user.locale if user else "en"
    title = t(locale, f"{kind}.title", **payload)
    body = t(locale, f"{kind}.body", **payload)
    n = Notification(user_id=user_id, kind=kind, payload={**payload, "title": title, "body": body})
    db.add(n)
    await db.commit()
    ctx.hub.send_to_users([user_id], "notification", NotificationOut.model_validate(n))
    if push and ctx.push is not None:
        try:
            await ctx.push.send_to_user(
                db,
                user_id,
                {"kind": kind, "title": title, "body": body, "tag": f"{kind}", "url": url},
            )
        except Exception:
            log.exception("push for notification failed")
    return n
