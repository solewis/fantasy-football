from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.sync_service import SyncError, get_status, sync_adp, sync_espn_players, sync_players

router = APIRouter(prefix="/sync")

DbSession = Annotated[Session, Depends(get_db)]

DEFAULT_SEASON = "2026"


class SyncInfo(BaseModel):
    last_synced_at: datetime | None
    record_count: int


class AdpSyncInfo(SyncInfo):
    season: str


class EspnPlayersSyncInfo(SyncInfo):
    adp_record_count: int


class SyncStatusResponse(BaseModel):
    players: SyncInfo
    adp: AdpSyncInfo
    espn_players: SyncInfo


@router.get("/status", response_model=SyncStatusResponse)
def get_sync_status(db: DbSession, season: str = DEFAULT_SEASON) -> SyncStatusResponse:
    return SyncStatusResponse(**get_status(db, season))


@router.post("/players", response_model=SyncInfo)
def trigger_players_sync(db: DbSession) -> SyncInfo:
    return SyncInfo(**sync_players(db))


@router.post("/adp", response_model=AdpSyncInfo)
def trigger_adp_sync(db: DbSession, season: str = DEFAULT_SEASON) -> AdpSyncInfo:
    return AdpSyncInfo(**sync_adp(db, season))


@router.post("/espn-players", response_model=EspnPlayersSyncInfo)
def trigger_espn_players_sync(db: DbSession, league_id: int | None = None) -> EspnPlayersSyncInfo:
    try:
        result = sync_espn_players(db, league_id)
    except SyncError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return EspnPlayersSyncInfo(**result)
