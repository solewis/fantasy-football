from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.ranks import list_my_ranks, replace_my_ranks

router = APIRouter(prefix="/ranks")

DbSession = Annotated[Session, Depends(get_db)]

DEFAULT_SEASON = "2026"
DEFAULT_FORMAT = "half_ppr"


class RankRow(BaseModel):
    rank: int
    platform_player_id: str
    name: str
    position: str | None
    team: str | None
    adp: float | None


class ReplaceRanksRequest(BaseModel):
    platform_player_ids: list[str]


class ReplaceRanksResponse(BaseModel):
    count: int


@router.get("", response_model=list[RankRow])
def get_ranks(
    db: DbSession,
    platform: str = "sleeper",
    season: str = DEFAULT_SEASON,
    format: str = DEFAULT_FORMAT,
) -> list[RankRow]:
    rows = list_my_ranks(db, platform, season, format)
    return [RankRow(**row) for row in rows]


@router.put("", response_model=ReplaceRanksResponse)
def put_ranks(
    payload: ReplaceRanksRequest,
    db: DbSession,
    platform: str = "sleeper",
    season: str = DEFAULT_SEASON,
    format: str = DEFAULT_FORMAT,
) -> ReplaceRanksResponse:
    count = replace_my_ranks(db, platform, season, format, payload.platform_player_ids)
    return ReplaceRanksResponse(count=count)
