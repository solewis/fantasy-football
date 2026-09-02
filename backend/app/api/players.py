from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.players import list_players

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]


class PlayerRow(BaseModel):
    """Deliberately shaped to match ranks.py's RankRow, so the frontend can swap
    an ADP-ordered list in wherever a saved rank list would go. `rank` is a
    synthesized ADP ordinal; `tier` is always null (ADP has no tiers) and exists
    only to keep the two shapes interchangeable.
    """

    rank: int
    platform_player_id: str
    name: str
    position: str | None
    team: str | None
    adp: float
    tier: None = None
    break_after: None = None
    flag: None = None


@router.get("/players", response_model=list[PlayerRow])
def get_players(
    db: DbSession,
    platform: str = "sleeper",
    season: str = "2026",
    format: str = "half_ppr",
    position: str | None = None,
    search: str | None = None,
) -> list[PlayerRow]:
    rows = list_players(db, platform, season, format, position=position, search=search)
    return [PlayerRow(rank=i + 1, **row) for i, row in enumerate(rows)]
