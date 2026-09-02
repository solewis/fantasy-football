from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.corpus.retrieve import passages_for_players
from app.corpus.service import (
    CORPUS_SOURCE_TYPE,
    CorpusError,
    delete_document,
    get_document,
    import_document,
    list_documents,
    rescan_document,
    summarize,
)
from app.db import get_db
from app.matching.mappings import confirm_mapping

router = APIRouter(prefix="/corpus")

DbSession = Annotated[Session, Depends(get_db)]

DEFAULT_PLATFORM = "sleeper"


class ImportDocumentRequest(BaseModel):
    """Text in a JSON body rather than multipart, matching the rank importer:
    the frontend reads the file with File.text() and the backend stays free of
    a python-multipart dependency.
    """

    analyst: str
    title: str
    kind: str
    text: str
    published_at: datetime | None = None
    filename: str | None = None
    platform: str = DEFAULT_PLATFORM


class AliasRequest(BaseModel):
    """A nickname the analyst uses that no platform player list contains.

    Confirming one writes a NameMapping under the corpus source type, which
    adds it to the scan set -- documents already imported pick it up on rescan.
    """

    normalized_name: str
    source_name_raw: str | None = None
    platform_player_id: str
    platform: str = DEFAULT_PLATFORM


@router.post("/documents")
def post_document(payload: ImportDocumentRequest, db: DbSession) -> dict:
    try:
        document = import_document(
            db,
            analyst=payload.analyst,
            title=payload.title,
            kind=payload.kind,
            text=payload.text,
            published_at=payload.published_at,
            source_filename=payload.filename,
            platform=payload.platform,
        )
    except CorpusError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return summarize(db, document)


@router.get("/documents")
def get_documents(db: DbSession, analyst: str | None = None) -> list[dict]:
    return list_documents(db, analyst)


@router.get("/documents/{document_id}")
def get_document_detail(document_id: int, db: DbSession) -> dict:
    document = get_document(db, document_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return summarize(db, document)


@router.post("/documents/{document_id}/rescan")
def post_rescan(document_id: int, db: DbSession, platform: str = DEFAULT_PLATFORM) -> dict:
    try:
        document = rescan_document(db, document_id, platform)
    except CorpusError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return summarize(db, document)


@router.delete("/documents/{document_id}", status_code=204)
def delete_document_route(document_id: int, db: DbSession) -> Response:
    try:
        delete_document(db, document_id)
    except CorpusError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return Response(status_code=204)


@router.get("/passages")
def get_passages(
    db: DbSession,
    platform_player_id: Annotated[list[str], Query()] = [],  # noqa: B006 -- FastAPI reads the default
    platform: str = DEFAULT_PLATFORM,
    analyst: str | None = None,
    per_player: int = 3,
) -> dict:
    """What the analyst wrote about these players.

    Exposed as its own endpoint rather than only being called in-process by the
    advice builder, because "does the corpus actually cover the players I care
    about" is a question worth being able to ask directly -- a silently empty
    result here is the difference between advice grounded in someone's writing
    and advice invented from nothing.
    """
    found = passages_for_players(db, list(platform_player_id), platform, analyst, per_player)
    return {
        player_id: [
            {
                "document_id": p.document_id,
                "document_title": p.document_title,
                "analyst": p.analyst,
                "kind": p.kind,
                "published_at": p.published_at,
                "chunk_index": p.chunk_index,
                "text": p.text,
                "detected_by": p.detected_by,
                "occurrences": p.occurrences,
            }
            for p in passages
        ]
        for player_id, passages in found.items()
    }


@router.post("/aliases")
def post_alias(payload: AliasRequest, db: DbSession) -> dict:
    mapping = confirm_mapping(
        db,
        platform=payload.platform,
        source_type=CORPUS_SOURCE_TYPE,
        source_name_raw=payload.source_name_raw or payload.normalized_name,
        normalized_name=payload.normalized_name,
        platform_player_id=payload.platform_player_id,
    )
    return {
        "normalized_name": mapping.normalized_name,
        "platform_player_id": mapping.platform_player_id,
    }
