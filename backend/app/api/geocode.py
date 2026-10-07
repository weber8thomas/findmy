"""Address search, to place a zone by its address (GEOCODER_URL; empty turns it off)."""

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status

from app.deps import Ctx, CurrentUser, rate_limit
from app.schemas import PlaceOut
from app.services.geocode import GeocodeError, Geocoder, normalize

router = APIRouter(tags=["geocode"])


@router.get("/geocode", response_model=list[PlaceOut])
async def geocode(
    user: CurrentUser, ctx: Ctx, q: Annotated[str, Query(min_length=1, max_length=200)]
):
    """Up to five places matching an address, named in the user's language."""
    geocoder: Geocoder | None = ctx.extras.get("geocoder")
    if geocoder is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "address search is turned off")
    if len(normalize(q)) < 2:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "query too short")
    # Enough to try a few spellings; not to geocode in bulk through this server.
    rate_limit(ctx, "geocode", user.id, 10, 60)
    rate_limit(ctx, "geocode-hour", user.id, 60, 3600)
    try:
        return await geocoder.search(q, user.locale or "en")
    except GeocodeError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "address search unavailable") from e
