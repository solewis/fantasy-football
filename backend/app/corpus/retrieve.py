"""Pulling the passages an analyst wrote about specific players.

This is the live half of the corpus, and it's a database query rather than a
similarity search on purpose. The question at pick time isn't "what's related
to this text" -- it's "what did they write about these fourteen players", and
that's an exact lookup once mentions are keyed by name.

Resolution to platform player ids happens here rather than at scan time, which
is what keeps one imported corpus usable from both a Sleeper and an ESPN
league (the same call app/rank_sources.py makes for imported rank datasets).
"""

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.corpus.mentions import FULL_NAME, SURNAME
from app.corpus.service import CORPUS_SOURCE_TYPE
from app.db import as_utc
from app.matching.normalize import normalize_name
from app.models import ChunkMention, CorpusChunk, CorpusDocument, NameMapping, PlatformPlayer

# A passage that names a player once in a list of twelve is not a passage about
# that player, and a surname hit is weaker evidence than a full-name one. These
# order the candidates; they never filter, since a thin mention is still better
# than nothing when it's all there is.
_DETECTION_WEIGHT = {FULL_NAME: 0, SURNAME: 1}


@dataclass(frozen=True)
class Passage:
    platform_player_id: str
    document_id: int
    document_title: str
    analyst: str
    kind: str
    published_at: datetime | None
    chunk_index: int
    text: str
    detected_by: str
    occurrences: int


def _names_by_player(
    session: Session, platform: str, platform_player_ids: list[str]
) -> dict[str, set[str]]:
    """Every normalized name that refers to each requested player.

    Two sources: the platform's own spelling, and any nicknames confirmed by
    hand under the corpus source type. A player can have several ("christian
    mccaffrey", "cmc"), and all of them have to be searched.
    """
    if not platform_player_ids:
        return {}
    wanted = set(platform_player_ids)

    names: dict[str, set[str]] = {}
    players = (
        session.query(PlatformPlayer)
        .filter(
            PlatformPlayer.platform == platform,
            PlatformPlayer.platform_player_id.in_(wanted),
        )
        .all()
    )
    for player in players:
        normalized = normalize_name(player.name)
        if normalized:
            names.setdefault(player.platform_player_id, set()).add(normalized)

    aliases = (
        session.query(NameMapping)
        .filter(
            NameMapping.platform == platform,
            NameMapping.source_type == CORPUS_SOURCE_TYPE,
            NameMapping.platform_player_id.in_(wanted),
        )
        .all()
    )
    for alias in aliases:
        names.setdefault(alias.platform_player_id, set()).add(alias.normalized_name)

    return names


def passages_for_players(
    session: Session,
    platform_player_ids: list[str],
    platform: str = "sleeper",
    analyst: str | None = None,
    per_player: int = 3,
) -> dict[str, list[Passage]]:
    """The best few passages about each requested player, keyed by player id.

    Ordered by how squarely the passage is about them (full-name mentions over
    bare surnames, more mentions over fewer) and then by recency, because a
    2023 take and a 2026 take on the same player are different claims and the
    newer one is usually the live one. `per_player` is the cap that keeps a
    fourteen-candidate board from assembling a prompt out of an entire season
    guide.
    """
    names_by_player = _names_by_player(session, platform, platform_player_ids)
    if not names_by_player:
        return {}

    player_by_name: dict[str, list[str]] = {}
    for player_id, names in names_by_player.items():
        for name in names:
            player_by_name.setdefault(name, []).append(player_id)

    query = (
        session.query(ChunkMention, CorpusChunk, CorpusDocument)
        .join(CorpusChunk, ChunkMention.chunk_id == CorpusChunk.id)
        .join(CorpusDocument, CorpusChunk.document_id == CorpusDocument.id)
        .filter(ChunkMention.normalized_name.in_(set(player_by_name)))
    )
    if analyst is not None:
        query = query.filter(CorpusDocument.analyst == analyst)

    found: dict[str, list[Passage]] = {}
    for mention, chunk, document in query.all():
        for player_id in player_by_name.get(mention.normalized_name, []):
            found.setdefault(player_id, []).append(
                Passage(
                    platform_player_id=player_id,
                    document_id=document.id,
                    document_title=document.title,
                    analyst=document.analyst,
                    kind=document.kind,
                    published_at=as_utc(document.published_at),
                    chunk_index=chunk.chunk_index,
                    text=chunk.text,
                    detected_by=mention.detected_by,
                    occurrences=mention.occurrences,
                )
            )

    # A tz-aware published_at can't be compared against a naive default, so the
    # "is it dated at all" boolean carries the undated rows to the back instead.
    def rank(passage: Passage) -> tuple:
        return (
            _DETECTION_WEIGHT.get(passage.detected_by, 2),
            -passage.occurrences,
            passage.published_at is None,
            -(passage.published_at.timestamp() if passage.published_at else 0),
        )

    return {
        player_id: sorted(passages, key=rank)[:per_player] for player_id, passages in found.items()
    }
