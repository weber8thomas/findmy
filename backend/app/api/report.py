"""Endpoints used by a device to report itself (authenticated with its device token)."""

from fastapi import APIRouter

from app.deps import DB, Ctx, ReportingDevice, rate_limit
from app.models import User
from app.providers.base import LocationFix
from app.schemas import AckIn, CommandOut, ReportIn, ReportOut, ReportState
from app.services import commands, locations
from app.services.devices import device_out, lost_mode_out

router = APIRouter(prefix="/report", tags=["report"])


@router.post("/locations", response_model=ReportOut, status_code=202)
async def report_locations(data: ReportIn, device: ReportingDevice, ctx: Ctx, db: DB):
    rate_limit(ctx, "report", device.id, 30, 60)
    fixes = [
        LocationFix(
            ts=f.ts,
            lat=f.lat,
            lon=f.lon,
            accuracy_m=f.accuracy,
            altitude_m=f.altitude,
            speed_mps=f.speed,
            heading_deg=f.heading,
            battery_level=data.battery.level if data.battery else None,
        )
        for f in data.fixes
    ]
    n = await locations.ingest(
        ctx,
        db,
        device,
        fixes,
        # Only browsers report here, also for an iCloud device they are attached to.
        source="browser",
        battery_level=data.battery.level if data.battery else None,
        battery_charging=data.battery.charging if data.battery else None,
    )
    return ReportOut(accepted=n)


@router.get("/state", response_model=ReportState)
async def report_state(device: ReportingDevice, ctx: Ctx, db: DB):
    owner = await db.get(User, device.owner_id)
    pending = await commands.pending_for_device(db, device.id)
    return ReportState(
        device=device_out(ctx, device, owner),
        lost_mode=lost_mode_out(device, owner),
        pending_commands=[CommandOut.model_validate(c) for c in pending],
    )


@router.post("/commands/{command_id}/ack", response_model=CommandOut)
async def ack_command(command_id: str, data: AckIn, device: ReportingDevice, ctx: Ctx, db: DB):
    return await commands.ack(ctx, db, device, command_id, data.status, data.error)
