from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.corpus.mentions import ALIAS, FULL_NAME, SURNAME
from app.corpus.retrieve import passages_for_players
from app.corpus.service import (
    CORPUS_SOURCE_TYPE,
    CorpusError,
    delete_document,
    import_document,
    list_documents,
    rescan_document,
    summarize,
)
from app.db import Base
from app.matching.mappings import confirm_mapping
from app.models import ChunkMention, CorpusChunk, PlatformPlayer

ANALYST = "The Guide Guy"


@pytest.fixture
def session():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autoflush=False, autocommit=False)()
    for player_id, name, position in [
        ("1", "Justin Jefferson", "WR"),
        ("2", "Christian McCaffrey", "RB"),
        ("3", "Jordan Love", "QB"),
        ("4", "Bijan Robinson", "RB"),
    ]:
        db.add(
            PlatformPlayer(
                platform="sleeper", platform_player_id=player_id, name=name, position=position
            )
        )
    db.commit()
    try:
        yield db
    finally:
        db.close()


def article(session, title, text, published_at=None, kind="article"):
    return import_document(
        session,
        analyst=ANALYST,
        title=title,
        kind=kind,
        text=text,
        published_at=published_at,
    )


def test_import_chunks_and_scans(session):
    document = article(
        session,
        "Draft Guide",
        "Justin Jefferson is the WR1 and it isn't close.\n\n"
        "Christian McCaffrey carries real injury risk at his age.",
    )
    summary = summarize(session, document)
    assert summary["chunk_count"] == 1
    assert summary["mention_count"] == 2
    assert summary["char_count"] == len(document.raw_text)


def test_mentions_resolve_to_players_on_read(session):
    article(session, "Guide", "Bijan Robinson is my RB1 this year.")
    passages = passages_for_players(session, ["4"], platform="sleeper")
    assert list(passages) == ["4"]
    assert "Bijan Robinson is my RB1" in passages["4"][0].text
    assert passages["4"][0].detected_by == FULL_NAME


def test_unmentioned_player_returns_nothing(session):
    article(session, "Guide", "Bijan Robinson is my RB1 this year.")
    assert passages_for_players(session, ["1"], platform="sleeper") == {}


def test_passages_carry_citation_metadata(session):
    published = datetime(2026, 7, 14, tzinfo=UTC)
    article(session, "July Update", "Jordan Love took a real leap.", published_at=published)
    passage = passages_for_players(session, ["3"], platform="sleeper")["3"][0]
    assert passage.document_title == "July Update"
    assert passage.analyst == ANALYST
    assert passage.published_at == published


def test_newer_take_ranks_first(session):
    article(
        session,
        "Old Take",
        "Jordan Love is a fade for me this season.",
        published_at=datetime(2024, 8, 1, tzinfo=UTC),
    )
    article(
        session,
        "New Take",
        "Jordan Love is a buy for me this season.",
        published_at=datetime(2026, 8, 1, tzinfo=UTC),
    )
    passages = passages_for_players(session, ["3"], platform="sleeper")["3"]
    assert [p.document_title for p in passages] == ["New Take", "Old Take"]


def test_undated_documents_sort_last(session):
    article(session, "Undated", "Jordan Love is interesting.")
    article(
        session, "Dated", "Jordan Love is a buy.", published_at=datetime(2024, 1, 1, tzinfo=UTC)
    )
    passages = passages_for_players(session, ["3"], platform="sleeper")["3"]
    assert [p.document_title for p in passages] == ["Dated", "Undated"]


def test_per_player_cap(session):
    for i in range(5):
        article(session, f"Piece {i}", f"Bijan Robinson looks good, note {i}.")
    passages = passages_for_players(session, ["4"], platform="sleeper", per_player=2)
    assert len(passages["4"]) == 2


def test_alias_is_scanned_after_being_confirmed(session):
    confirm_mapping(
        session,
        platform="sleeper",
        source_type=CORPUS_SOURCE_TYPE,
        source_name_raw="CMC",
        normalized_name="cmc",
        platform_player_id="2",
    )
    article(session, "Nickname Piece", "CMC is fully healthy and back to being CMC.")
    passage = passages_for_players(session, ["2"], platform="sleeper")["2"][0]
    assert passage.detected_by == ALIAS
    assert passage.occurrences == 2


def test_rescan_picks_up_a_newly_confirmed_alias(session):
    document = article(session, "Nickname Piece", "CMC is fully healthy.")
    assert passages_for_players(session, ["2"], platform="sleeper") == {}

    confirm_mapping(
        session,
        platform="sleeper",
        source_type=CORPUS_SOURCE_TYPE,
        source_name_raw="CMC",
        normalized_name="cmc",
        platform_player_id="2",
    )
    rescan_document(session, document.id)
    assert "2" in passages_for_players(session, ["2"], platform="sleeper")


def test_rescan_replaces_rather_than_duplicates(session):
    document = article(session, "Guide", "Bijan Robinson is my RB1.")
    before = summarize(session, document)
    rescan_document(session, document.id)
    assert summarize(session, document) == before


def test_surname_across_chunks_is_attributed(session):
    body = "Justin Jefferson opens the tier.\n\n" + ("filler text. " * 200) + "\n\nJefferson stays."
    article(session, "Long Guide", body)
    passages = passages_for_players(session, ["1"], platform="sleeper")["1"]
    assert any(p.detected_by == SURNAME for p in passages)


def test_duplicate_title_for_same_analyst_is_rejected(session):
    article(session, "Guide", "Bijan Robinson is my RB1.")
    with pytest.raises(CorpusError, match="already has a document"):
        article(session, "Guide", "Different text entirely.")


def test_same_title_under_a_different_analyst_is_fine(session):
    article(session, "Guide", "Bijan Robinson is my RB1.")
    import_document(
        session, analyst="Someone Else", title="Guide", kind="article", text="Bijan is fine."
    )
    assert len(list_documents(session)) == 2
    assert len(list_documents(session, analyst=ANALYST)) == 1


def test_unknown_kind_is_rejected(session):
    with pytest.raises(CorpusError, match="Unknown document kind"):
        import_document(
            session, analyst=ANALYST, title="X", kind="newsletter", text="Bijan Robinson."
        )


def test_blank_text_is_rejected(session):
    with pytest.raises(CorpusError, match="no text"):
        article(session, "Empty", "   \n\n  ")


def test_delete_removes_chunks_and_mentions(session):
    document = article(session, "Guide", "Bijan Robinson is my RB1.")
    delete_document(session, document.id)
    assert list_documents(session) == []
    assert session.query(CorpusChunk).count() == 0
    assert session.query(ChunkMention).count() == 0


def test_documents_list_newest_first(session):
    article(session, "Older", "Bijan.", published_at=datetime(2025, 1, 1, tzinfo=UTC))
    article(session, "Newer", "Bijan.", published_at=datetime(2026, 1, 1, tzinfo=UTC))
    article(session, "Undated", "Bijan.")
    assert [d["title"] for d in list_documents(session)] == ["Newer", "Older", "Undated"]
