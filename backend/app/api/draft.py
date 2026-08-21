from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.draft import (
    DraftError,
    create_draft,
    create_draft_from_league,
    create_sleeper_draft,
    get_status,
    list_drafts,
    list_queue,
    make_pick,
    replace_queue,
    switch_to_manual,
    sync_sleeper_draft,
    undo_last_pick,
)

router = APIRouter(prefix="/drafts")

DbSession = Annotated[Session, Depends(get_db)]


class CreateDraftRequest(BaseModel):
    season: str
    format: str
    num_teams: int
    num_rounds: int
    my_slot: int


class CreateSleeperDraftRequest(BaseModel):
    platform_draft_id: str
    format: str
    my_slot: int


class CreateDraftFromLeagueRequest(BaseModel):
    league_id: int
    my_slot: int


class DraftSummary(BaseModel):
    id: int
    platform: str
    platform_draft_id: str | None
    league_id: int | None
    season: str
    format: str
    num_teams: int
    num_rounds: int
    my_slot: int
    rank_set_id: int | None
    roster_positions: list[str] | None
    team_names: dict[str, str]


class DraftListRow(BaseModel):
    """A lightweight per-draft summary for the Leagues UI -- not a full
    DraftStatus (no picks, no rank_set_id/roster_positions -- those need a
    League join that list_drafts() deliberately skips per-row to avoid N+1)."""

    id: int
    platform: str
    league_id: int | None
    season: str
    format: str
    num_teams: int
    num_rounds: int
    my_slot: int
    pick_count: int
    next_pick_number: int | None
    current_round: int | None
    is_complete: bool
    created_at: datetime


class PickRow(BaseModel):
    pick_number: int
    round: int
    slot: int
    platform_player_id: str
    name: str
    position: str | None
    team: str | None


class DraftStatus(BaseModel):
    draft: DraftSummary
    picks: list[PickRow]
    next_pick_number: int | None
    current_round: int | None
    current_slot: int | None
    is_my_turn: bool
    is_complete: bool


class MakePickRequest(BaseModel):
    platform_player_id: str


class MakePickResponse(BaseModel):
    pick_number: int


class QueueRow(BaseModel):
    platform_player_id: str
    name: str
    position: str | None
    team: str | None


class ReplaceQueueRequest(BaseModel):
    platform_player_ids: list[str]


class ReplaceQueueResponse(BaseModel):
    count: int


@router.get("", response_model=list[DraftListRow])
def get_drafts(db: DbSession, league_id: int | None = None) -> list[DraftListRow]:
    return [DraftListRow(**row) for row in list_drafts(db, league_id)]


@router.post("", response_model=DraftStatus)
def post_draft(payload: CreateDraftRequest, db: DbSession) -> DraftStatus:
    draft = create_draft(
        db, payload.season, payload.format, payload.num_teams, payload.num_rounds, payload.my_slot
    )
    status = get_status(db, draft.id)
    return DraftStatus(**status)


@router.post("/sleeper", response_model=DraftStatus)
def post_sleeper_draft(payload: CreateSleeperDraftRequest, db: DbSession) -> DraftStatus:
    try:
        draft = create_sleeper_draft(db, payload.platform_draft_id, payload.format, payload.my_slot)
    except DraftError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    status = get_status(db, draft.id)
    return DraftStatus(**status)


@router.post("/league", response_model=DraftStatus)
def post_draft_from_league(payload: CreateDraftFromLeagueRequest, db: DbSession) -> DraftStatus:
    try:
        draft = create_draft_from_league(db, payload.league_id, payload.my_slot)
    except DraftError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    status = get_status(db, draft.id)
    return DraftStatus(**status)


@router.post("/{draft_id}/sync", response_model=DraftStatus)
def post_sync(draft_id: int, db: DbSession) -> DraftStatus:
    try:
        status = sync_sleeper_draft(db, draft_id)
    except DraftError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return DraftStatus(**status)


@router.post("/{draft_id}/switch-to-manual", response_model=DraftStatus)
def post_switch_to_manual(draft_id: int, db: DbSession) -> DraftStatus:
    try:
        status = switch_to_manual(db, draft_id)
    except DraftError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return DraftStatus(**status)


@router.get("/{draft_id}", response_model=DraftStatus)
def get_draft_status(draft_id: int, db: DbSession) -> DraftStatus:
    status = get_status(db, draft_id)
    if status is None:
        raise HTTPException(status_code=404, detail="Draft not found")
    return DraftStatus(**status)


@router.post("/{draft_id}/picks", response_model=MakePickResponse)
def post_pick(draft_id: int, payload: MakePickRequest, db: DbSession) -> MakePickResponse:
    try:
        result = make_pick(db, draft_id, payload.platform_player_id)
    except DraftError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return MakePickResponse(**result)


@router.delete("/{draft_id}/picks", response_model=MakePickResponse | None)
def delete_last_pick(draft_id: int, db: DbSession) -> MakePickResponse | None:
    try:
        undone = undo_last_pick(db, draft_id)
    except DraftError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if undone is None:
        return None
    return MakePickResponse(pick_number=undone["pick_number"])


@router.get("/{draft_id}/queue", response_model=list[QueueRow])
def get_queue(draft_id: int, db: DbSession) -> list[QueueRow]:
    return [QueueRow(**row) for row in list_queue(db, draft_id)]


@router.put("/{draft_id}/queue", response_model=ReplaceQueueResponse)
def put_queue(draft_id: int, payload: ReplaceQueueRequest, db: DbSession) -> ReplaceQueueResponse:
    count = replace_queue(db, draft_id, payload.platform_player_ids)
    return ReplaceQueueResponse(count=count)
