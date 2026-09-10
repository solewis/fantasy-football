"""Importing and managing an analyst's body of writing.

A document is stored platform-agnostically, exactly like RankDataset: chunks
hang off it, mentions hang off those keyed by normalized name, and resolving a
name to a Sleeper or ESPN player id happens on read (app/corpus/retrieve.py).

Nicknames resolve through NameMapping under CORPUS_SOURCE_TYPE, the same table
the rank importer uses. Fantasy writers lean on shorthand constantly ("CMC",
"JSN") and no platform's player list contains any of it, so the scanner can't
find those on its own -- but confirming one mapping by hand adds it to the
scan set for every rescan afterwards.
"""

from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.corpus.chunk import chunk_text
from app.corpus.mentions import build_name_index, scan_document
from app.db import as_utc
from app.models import ChunkMention, CorpusChunk, CorpusDocument, NameMapping, PlatformPlayer

CORPUS_SOURCE_TYPE = "corpus"

DOCUMENT_KINDS = frozenset({"article", "guide", "rankings", "transcript"})


class CorpusError(ValueError):
    """A corpus action that can't be satisfied (duplicate title, unknown id, ...)."""


def _platform_players(session: Session, platform: str) -> list[dict]:
    rows = session.query(PlatformPlayer).filter_by(platform=platform).all()
    return [
        {"platform_player_id": r.platform_player_id, "name": r.name, "position": r.position}
        for r in rows
    ]


def _aliases(session: Session, platform: str) -> list[str]:
    """Hand-confirmed nicknames for this platform, as normalized names to scan for.

    Only mappings that point at a real player are useful here -- a confirmed
    "no match" records that a name isn't a player, which is precisely the thing
    not to scan for.
    """
    rows = (
        session.query(NameMapping.normalized_name)
        .filter(
            NameMapping.platform == platform,
            NameMapping.source_type == CORPUS_SOURCE_TYPE,
            NameMapping.platform_player_id.isnot(None),
        )
        .all()
    )
    return [row[0] for row in rows]


def import_document(
    session: Session,
    analyst: str,
    title: str,
    kind: str,
    text: str,
    published_at: datetime | None = None,
    source_filename: str | None = None,
    platform: str = "sleeper",
) -> CorpusDocument:
    analyst = analyst.strip()
    title = title.strip()
    if not analyst:
        raise CorpusError("Analyst can't be blank")
    if not title:
        raise CorpusError("Title can't be blank")
    if kind not in DOCUMENT_KINDS:
        raise CorpusError(f"Unknown document kind {kind!r}")
    if not text.strip():
        raise CorpusError("This document has no text")

    existing = session.query(CorpusDocument).filter_by(analyst=analyst, title=title).one_or_none()
    if existing:
        raise CorpusError(f"{analyst} already has a document titled {title!r}")

    document = CorpusDocument(
        analyst=analyst,
        title=title,
        kind=kind,
        published_at=published_at,
        source_filename=source_filename,
        raw_text=text,
        imported_at=datetime.now(UTC),
    )
    session.add(document)
    session.commit()
    session.refresh(document)

    _write_chunks(session, document, platform)
    return document


def rescan_document(
    session: Session, document_id: int, platform: str = "sleeper"
) -> CorpusDocument:
    """Re-chunk and re-scan a document from its stored text.

    The reason raw_text survives import: the chunker and the scanner will both
    get better (a new alias, a wider window), and improving them shouldn't mean
    finding and re-uploading a file from last August. Keeps the same document
    id so nothing referencing it breaks.
    """
    document = get_document(session, document_id)
    if document is None:
        raise CorpusError("Document not found")
    _write_chunks(session, document, platform)
    return document


def _write_chunks(session: Session, document: CorpusDocument, platform: str) -> None:
    _delete_chunks(session, document.id)

    chunks = chunk_text(document.raw_text)
    index = build_name_index(_platform_players(session, platform), _aliases(session, platform))
    scanned = scan_document([c.text for c in chunks], index)

    for position, (chunk, mentions) in enumerate(zip(chunks, scanned, strict=True)):
        row = CorpusChunk(
            document_id=document.id,
            chunk_index=position,
            text=chunk.text,
            char_start=chunk.char_start,
        )
        session.add(row)
        session.flush()
        for mention in mentions:
            session.add(
                ChunkMention(
                    chunk_id=row.id,
                    source_name_raw=mention.source_name_raw,
                    normalized_name=mention.normalized_name,
                    detected_by=mention.detected_by,
                    occurrences=mention.occurrences,
                )
            )
    session.commit()


def _delete_chunks(session: Session, document_id: int) -> None:
    # No PRAGMA foreign_keys=ON in this app, so children go explicitly --
    # same as delete_dataset.
    chunk_ids = [
        row[0] for row in session.query(CorpusChunk.id).filter_by(document_id=document_id).all()
    ]
    if chunk_ids:
        session.query(ChunkMention).filter(ChunkMention.chunk_id.in_(chunk_ids)).delete(
            synchronize_session=False
        )
    session.query(CorpusChunk).filter_by(document_id=document_id).delete()
    session.commit()


def get_document(session: Session, document_id: int) -> CorpusDocument | None:
    return session.get(CorpusDocument, document_id)


def delete_document(session: Session, document_id: int) -> None:
    document = get_document(session, document_id)
    if document is None:
        raise CorpusError("Document not found")
    _delete_chunks(session, document.id)
    session.delete(document)
    session.commit()


def summarize(session: Session, document: CorpusDocument) -> dict:
    chunk_count = session.query(CorpusChunk).filter_by(document_id=document.id).count()
    mention_count = (
        session.query(ChunkMention)
        .join(CorpusChunk, ChunkMention.chunk_id == CorpusChunk.id)
        .filter(CorpusChunk.document_id == document.id)
        .count()
    )
    return {
        "id": document.id,
        "analyst": document.analyst,
        "title": document.title,
        "kind": document.kind,
        "published_at": as_utc(document.published_at),
        "source_filename": document.source_filename,
        "char_count": len(document.raw_text),
        "chunk_count": chunk_count,
        "mention_count": mention_count,
        "imported_at": as_utc(document.imported_at),
    }


def list_documents(session: Session, analyst: str | None = None) -> list[dict]:
    query = session.query(CorpusDocument)
    if analyst is not None:
        query = query.filter(CorpusDocument.analyst == analyst)
    # Newest writing first: recency is the dominant axis for this content, and
    # a null published_at (an undated scrape) sorts last rather than first.
    documents = query.order_by(
        CorpusDocument.published_at.is_(None),
        CorpusDocument.published_at.desc(),
        CorpusDocument.id.desc(),
    ).all()
    return [summarize(session, document) for document in documents]
