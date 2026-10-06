"""Periodic cleanup: expire commands & shares, purge sessions and old positions."""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import delete

from app.clock import utcnow
from app.context import AppContext
from app.models import Session
from app.services import commands, locations, sharing

log = logging.getLogger(__name__)


async def run_once(ctx: AppContext, *, purge_locations: bool) -> None:
    async with ctx.sessionmaker() as db:
        await commands.expire_old(ctx, db)
        await sharing.expire_old(ctx, db)
        await db.execute(delete(Session).where(Session.expires_at <= utcnow()))
        await db.commit()
        if purge_locations:
            n = await locations.purge_old(db, ctx.settings.location_retention_days)
            if n:
                log.info("purged %d old locations", n)


async def loop(ctx: AppContext) -> None:
    last_purge = utcnow() - timedelta(days=1)
    while True:
        try:
            now = utcnow()
            purge = now - last_purge >= timedelta(hours=24)
            await run_once(ctx, purge_locations=purge)
            if purge:
                last_purge = now
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("housekeeping failed")
        await asyncio.sleep(ctx.settings.housekeeping_interval_s)
