from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.db import get_db
from app.rank_datasets import (
    RankDatasetError,
    auto_confirm_matches,
    confirm_names,
    create_dataset,
    delete_dataset,
    get_dataset,
    list_datasets,
    list_unmatched,
    preview_dataset,
    rename_dataset,
    reparse_dataset,
)
from app.rank_import.parse import ColumnMapping

router = APIRouter()

DbSession = Annotated[Session, Depends(get_db)]

DEFAULT_SEASON = "2026"
DEFAULT_FORMAT = "half_ppr"


class ColumnMappingModel(BaseModel):
    name: int | None = None
    position: int | None = None
    team: int | None = None
    overall_rank: int | None = None
    position_rank: int | None = None
    tier: int | None = None
    overall_rank_from_row_order: bool = False
    single_position: str | None = None

    def to_mapping(self) -> ColumnMapping:
        return ColumnMapping(**self.model_dump())


class PreviewRequest(BaseModel):
    """The file arrives as text in a JSON body rather than multipart.

    The frontend reads it with File.text(), which avoids a python-multipart
    dependency for one endpoint and keeps the parser a pure str -> rows
    function. Parsing still happens server-side -- doing it in the browser
    would mean two parsers that have to agree forever.
    """

    text: str
    filename: str | None = None
    mapping: ColumnMappingModel | None = None


class CreateDatasetRequest(BaseModel):
    name: str
    text: str
    season: str = DEFAULT_SEASON
    format: str = DEFAULT_FORMAT
    filename: str | None = None
    mapping: ColumnMappingModel | None = None


class ReparseRequest(BaseModel):
    mapping: ColumnMappingModel


class RenameDatasetRequest(BaseModel):
    name: str


class NameConfirmation(BaseModel):
    normalized_name: str
    source_name_raw: str | None = None
    # None records a confirmed "not a player", so the name is never asked about
    # again -- NameMapping already models exactly that.
    platform_player_id: str | None = None


class ConfirmNamesRequest(BaseModel):
    confirmations: list[NameConfirmation]


@router.post("/rank-datasets/preview")
def post_preview(payload: PreviewRequest, db: DbSession) -> dict:
    mapping = payload.mapping.to_mapping() if payload.mapping else None
    return preview_dataset(payload.text, mapping)


@router.post("/rank-datasets")
def post_dataset(payload: CreateDatasetRequest, db: DbSession) -> dict:
    try:
        dataset = create_dataset(
            db,
            payload.name,
            payload.season,
            payload.format,
            payload.text,
            mapping=payload.mapping.to_mapping() if payload.mapping else None,
            source_filename=payload.filename,
        )
    except RankDatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _detail(db, dataset.id)


@router.get("/rank-datasets")
def get_datasets(db: DbSession, season: str | None = None, format: str | None = None) -> list[dict]:
    return list_datasets(db, season, format)


@router.get("/rank-datasets/{dataset_id}")
def get_dataset_detail(dataset_id: int, db: DbSession, platform: str = "sleeper") -> dict:
    if get_dataset(db, dataset_id) is None:
        raise HTTPException(status_code=404, detail="Dataset not found")
    return _detail(db, dataset_id, platform)


def _detail(db: Session, dataset_id: int, platform: str = "sleeper") -> dict:
    dataset = get_dataset(db, dataset_id)
    summary = next(d for d in list_datasets(db) if d["id"] == dataset_id)
    # Auto-confirming here (rather than on a separate call) means the review
    # queue a client sees is always just the genuinely ambiguous remainder.
    counts = auto_confirm_matches(db, dataset_id, platform)
    return {**summary, "column_mapping": dataset.column_mapping, "resolution": counts}


@router.post("/rank-datasets/{dataset_id}/reparse")
def post_reparse(dataset_id: int, payload: ReparseRequest, db: DbSession) -> dict:
    try:
        reparse_dataset(db, dataset_id, payload.mapping.to_mapping())
    except RankDatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _detail(db, dataset_id)


@router.patch("/rank-datasets/{dataset_id}")
def patch_dataset(dataset_id: int, payload: RenameDatasetRequest, db: DbSession) -> dict:
    try:
        rename_dataset(db, dataset_id, payload.name)
    except RankDatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _detail(db, dataset_id)


@router.delete("/rank-datasets/{dataset_id}", status_code=204)
def delete_dataset_route(dataset_id: int, db: DbSession) -> Response:
    try:
        delete_dataset(db, dataset_id)
    except RankDatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return Response(status_code=204)


@router.get("/rank-datasets/{dataset_id}/unmatched")
def get_unmatched(dataset_id: int, db: DbSession, platform: str = "sleeper") -> list[dict]:
    try:
        return list_unmatched(db, dataset_id, platform)
    except RankDatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/rank-datasets/{dataset_id}/mappings")
def post_mappings(
    dataset_id: int, payload: ConfirmNamesRequest, db: DbSession, platform: str = "sleeper"
) -> dict:
    try:
        confirmed = confirm_names(db, platform, [c.model_dump() for c in payload.confirmations])
        remaining = len(list_unmatched(db, dataset_id, platform))
    except RankDatasetError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"confirmed": confirmed, "remaining_unmatched": remaining}
