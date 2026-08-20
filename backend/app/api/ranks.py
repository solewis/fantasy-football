from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.ranks import (
    RankSetError,
    create_rank_set,
    delete_rank_set,
    list_rank_sets,
    list_ranks,
    rename_rank_set,
    replace_ranks,
    resolve_rank_set,
)

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]

DEFAULT_SEASON = "2026"
DEFAULT_FORMAT = "half_ppr"


class RankSetSummary(BaseModel):
    id: int
    name: str
    platform: str
    season: str
    format: str
    player_count: int


class CreateRankSetRequest(BaseModel):
    name: str
    season: str = DEFAULT_SEASON
    format: str = DEFAULT_FORMAT
    platform: str = "sleeper"
    seed_from_adp: bool = True


class RenameRankSetRequest(BaseModel):
    name: str


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


@router.get("/rank-sets", response_model=list[RankSetSummary])
def get_rank_sets(
    db: DbSession,
    platform: str = "sleeper",
    season: str | None = None,
    format: str | None = None,
) -> list[RankSetSummary]:
    rows = list_rank_sets(db, platform, season, format)
    return [RankSetSummary(**row) for row in rows]


@router.post("/rank-sets", response_model=RankSetSummary)
def post_rank_set(payload: CreateRankSetRequest, db: DbSession) -> RankSetSummary:
    try:
        rank_set = create_rank_set(
            db,
            payload.name,
            payload.season,
            payload.format,
            platform=payload.platform,
            seed_from_adp=payload.seed_from_adp,
        )
    except RankSetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    rows = list_rank_sets(db, payload.platform, payload.season, payload.format)
    summary = next(row for row in rows if row["id"] == rank_set.id)
    return RankSetSummary(**summary)


@router.patch("/rank-sets/{rank_set_id}", response_model=RankSetSummary)
def patch_rank_set(
    rank_set_id: int, payload: RenameRankSetRequest, db: DbSession
) -> RankSetSummary:
    try:
        rank_set = rename_rank_set(db, rank_set_id, payload.name)
    except RankSetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    rows = list_rank_sets(db, rank_set.platform, rank_set.season, rank_set.format)
    summary = next(row for row in rows if row["id"] == rank_set.id)
    return RankSetSummary(**summary)


@router.delete("/rank-sets/{rank_set_id}", status_code=204)
def delete_rank_set_route(rank_set_id: int, db: DbSession) -> Response:
    try:
        delete_rank_set(db, rank_set_id)
    except RankSetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(status_code=204)


@router.get("/rank-sets/{rank_set_id}/ranks", response_model=list[RankRow])
def get_rank_set_ranks(rank_set_id: int, db: DbSession) -> list[RankRow]:
    rows = list_ranks(db, rank_set_id)
    return [RankRow(**row) for row in rows]


@router.put("/rank-sets/{rank_set_id}/ranks", response_model=ReplaceRanksResponse)
def put_rank_set_ranks(
    rank_set_id: int, payload: ReplaceRanksRequest, db: DbSession
) -> ReplaceRanksResponse:
    count = replace_ranks(db, rank_set_id, payload.platform_player_ids)
    return ReplaceRanksResponse(count=count)


@router.get("/ranks", response_model=list[RankRow])
def get_ranks(
    db: DbSession,
    platform: str = "sleeper",
    season: str = DEFAULT_SEASON,
    format: str = DEFAULT_FORMAT,
) -> list[RankRow]:
    """Resolver-backed read used by the draft player pool's ADP-fallback fetch --
    "the ranks for this format" (see resolve_rank_set's docstring for the caveat).
    """
    rank_set = resolve_rank_set(db, platform, season, format)
    if rank_set is None:
        return []
    rows = list_ranks(db, rank_set.id)
    return [RankRow(**row) for row in rows]
