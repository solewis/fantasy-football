from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, model_validator
from sqlalchemy.orm import Session

from app.db import get_db
from app.rank_import.refs import RankRefError
from app.rank_sources import RankSourceError, build_rank_pool, list_available_sources
from app.ranks import (
    OVERALL,
    RankEntryInput,
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
    scope: str
    player_count: int


class CreateRankSetRequest(BaseModel):
    name: str
    season: str = DEFAULT_SEASON
    format: str = DEFAULT_FORMAT
    platform: str = "sleeper"
    scope: str = OVERALL
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
    tier: int | None
    break_after: str | None = None
    flag: str | None = None


class ReplaceRankEntry(BaseModel):
    platform_player_id: str
    tier: int | None = None
    break_after: str | None = None
    flag: str | None = None


class ReplaceRanksRequest(BaseModel):
    """Accepts either shape for one release.

    `entries` is the real one -- it carries tiers. `platform_player_ids` is the
    original tier-less shape the frontend still posts; it stays accepted until
    the frontend switches over, then goes away in its own commit. Exactly one
    must be supplied, so a caller sending both (or neither) gets a 422 rather
    than having one silently ignored.
    """

    entries: list[ReplaceRankEntry] | None = None
    platform_player_ids: list[str] | None = None

    @model_validator(mode="after")
    def exactly_one_shape(self) -> "ReplaceRanksRequest":
        if (self.entries is None) == (self.platform_player_ids is None):
            raise ValueError("Supply exactly one of 'entries' or 'platform_player_ids'")
        return self

    def to_entries(self) -> list[RankEntryInput]:
        if self.entries is not None:
            return [
                RankEntryInput(
                    platform_player_id=e.platform_player_id,
                    tier=e.tier,
                    break_after=e.break_after,
                    flag=e.flag,
                )
                for e in self.entries
            ]
        assert self.platform_player_ids is not None
        return [RankEntryInput(platform_player_id=pid) for pid in self.platform_player_ids]


class ReplaceRanksResponse(BaseModel):
    count: int


@router.get("/rank-sets", response_model=list[RankSetSummary])
def get_rank_sets(
    db: DbSession,
    platform: str = "sleeper",
    season: str | None = None,
    format: str | None = None,
    scope: str | None = None,
) -> list[RankSetSummary]:
    rows = list_rank_sets(db, platform, season, format, scope)
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
            scope=payload.scope,
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
    count = replace_ranks(db, rank_set_id, payload.to_entries())
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


@router.get("/rank-sources")
def get_rank_sources(
    db: DbSession,
    platform: str = "sleeper",
    season: str = DEFAULT_SEASON,
    format: str = DEFAULT_FORMAT,
) -> list[dict]:
    """Everything selectable as a source in the builder: ADP, imported
    datasets, and your own rank sets.
    """
    return list_available_sources(db, platform, season, format)


@router.get("/rank-pool")
def get_rank_pool(
    db: DbSession,
    source_ref: Annotated[list[str], Query()] = [],  # noqa: B006 -- FastAPI reads the default
    platform: str = "sleeper",
    season: str = DEFAULT_SEASON,
    format: str = DEFAULT_FORMAT,
    scope: str = OVERALL,
) -> dict:
    """Every player the selected sources rank, with what each source says.

    Deliberately returns no averages, no ordering by merit and no suggested
    pick -- the tool reports what the sources think and the human decides. It
    also returns the *whole* pool in one response so the client can recompute
    against a new slot on every pick without a round trip.
    """
    try:
        return build_rank_pool(db, list(source_ref), platform, season, format, scope)
    except (RankSourceError, RankRefError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
