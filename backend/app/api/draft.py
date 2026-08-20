from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.draft import (
    DraftError,
    create_draft,
    get_status,
    list_queue,
    make_pick,
    replace_queue,
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


class DraftSummary(BaseModel):
    id: int
    season: str
    format: str
    num_teams: int
    num_rounds: int
    my_slot: int


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


@router.post("", response_model=DraftStatus)
def post_draft(payload: CreateDraftRequest, db: DbSession) -> DraftStatus:
    draft = create_draft(
        db, payload.season, payload.format, payload.num_teams, payload.num_rounds, payload.my_slot
    )
    status = get_status(db, draft.id)
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
    undone = undo_last_pick(db, draft_id)
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
