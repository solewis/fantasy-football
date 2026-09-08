from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.exposure import ExposureError, delete_exposure, list_exposures, set_exposure

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]

DEFAULT_SEASON = "2026"


class ExposureRow(BaseModel):
    id: int
    platform: str
    season: str
    platform_player_id: str
    name: str
    position: str | None
    team: str | None
    shares: int
    updated_at: datetime


class SetExposureRequest(BaseModel):
    platform: str = "sleeper"
    season: str = DEFAULT_SEASON
    platform_player_id: str
    shares: int


@router.get("/exposures", response_model=list[ExposureRow])
def get_exposures(
    db: DbSession,
    platform: str = "sleeper",
    season: str | None = None,
) -> list[ExposureRow]:
    rows = list_exposures(db, platform, season)
    return [ExposureRow(**row) for row in rows]


@router.post("/exposures", response_model=ExposureRow)
def post_exposure(payload: SetExposureRequest, db: DbSession) -> ExposureRow:
    """Create or update your share count for a player -- upsert, not a plain
    create, so editing an existing player's shares is the same request as
    adding a new one.
    """
    try:
        row = set_exposure(
            db, payload.platform, payload.season, payload.platform_player_id, payload.shares
        )
    except ExposureError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return ExposureRow(**row)


@router.delete("/exposures/{exposure_id}", status_code=204)
def delete_exposure_route(exposure_id: int, db: DbSession) -> Response:
    try:
        delete_exposure(db, exposure_id)
    except ExposureError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(status_code=204)
