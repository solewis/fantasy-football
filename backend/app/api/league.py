from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.league import (
    LeagueError,
    create_league,
    delete_league,
    list_leagues,
    lookup_sleeper_league,
    sync_league,
    update_format,
    update_rank_set,
)
from app.models import League

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]


class LookupLeagueResponse(BaseModel):
    name: str
    season: str
    num_teams: int
    roster_positions: list[str]
    suggested_format: str | None


class LeagueSummary(BaseModel):
    id: int
    platform: str
    platform_league_id: str
    name: str
    season: str
    format: str
    num_teams: int
    roster_positions: list[str]
    team_names: dict[str, str]
    rank_set_id: int | None


class CreateLeagueRequest(BaseModel):
    platform_league_id: str
    format: str
    rank_set_id: int | None = None


class UpdateFormatRequest(BaseModel):
    format: str


class UpdateRankSetRequest(BaseModel):
    rank_set_id: int | None


def _to_summary(league: League) -> LeagueSummary:
    return LeagueSummary(
        id=league.id,
        platform=league.platform,
        platform_league_id=league.platform_league_id,
        name=league.name,
        season=league.season,
        format=league.format,
        num_teams=league.num_teams,
        roster_positions=league.roster_positions,
        team_names=league.team_names,
        rank_set_id=league.rank_set_id,
    )


@router.get("/leagues/lookup", response_model=LookupLeagueResponse)
def get_league_lookup(platform_league_id: str, db: DbSession) -> LookupLeagueResponse:
    try:
        meta = lookup_sleeper_league(platform_league_id)
    except LeagueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return LookupLeagueResponse(**meta)


@router.get("/leagues", response_model=list[LeagueSummary])
def get_leagues(db: DbSession) -> list[LeagueSummary]:
    return [_to_summary(league_row) for league_row in list_leagues(db)]


@router.post("/leagues", response_model=LeagueSummary)
def post_league(payload: CreateLeagueRequest, db: DbSession) -> LeagueSummary:
    try:
        league_row = create_league(
            db, payload.platform_league_id, payload.format, payload.rank_set_id
        )
    except LeagueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_summary(league_row)


@router.post("/leagues/{league_id}/sync", response_model=LeagueSummary)
def post_league_sync(league_id: int, db: DbSession) -> LeagueSummary:
    try:
        league_row = sync_league(db, league_id)
    except LeagueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_summary(league_row)


@router.patch("/leagues/{league_id}/format", response_model=LeagueSummary)
def patch_league_format(
    league_id: int, payload: UpdateFormatRequest, db: DbSession
) -> LeagueSummary:
    try:
        league_row = update_format(db, league_id, payload.format)
    except LeagueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_summary(league_row)


@router.patch("/leagues/{league_id}/rank-set", response_model=LeagueSummary)
def patch_league_rank_set(
    league_id: int, payload: UpdateRankSetRequest, db: DbSession
) -> LeagueSummary:
    try:
        league_row = update_rank_set(db, league_id, payload.rank_set_id)
    except LeagueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _to_summary(league_row)


@router.delete("/leagues/{league_id}", status_code=204)
def delete_league_route(league_id: int, db: DbSession) -> Response:
    try:
        delete_league(db, league_id)
    except LeagueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(status_code=204)
