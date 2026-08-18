from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.matching.mappings import confirm_mapping
from app.matching.pipeline import resolve_rows
from app.matching.resolve import AUTO_MATCHED, NEEDS_REVIEW

PLATFORM_PLAYERS = [
    {"platform_player_id": "1", "name": "Patrick Mahomes", "position": "QB", "team": "KC"},
]


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_resolve_rows_auto_matches_exact_names():
    session = make_session()

    results = resolve_rows(
        session,
        "sleeper",
        "sheet_rank",
        [{"name": "Patrick Mahomes", "position": "QB"}],
        PLATFORM_PLAYERS,
    )

    assert results[0]["status"] == AUTO_MATCHED
    assert results[0]["platform_player_id"] == "1"


def test_resolve_rows_flags_typo_then_reuses_confirmation_on_rerun():
    session = make_session()
    row = [{"name": "Patric Mahomes", "position": "QB"}]

    first_pass = resolve_rows(session, "sleeper", "sheet_rank", row, PLATFORM_PLAYERS)
    assert first_pass[0]["status"] == NEEDS_REVIEW

    confirm_mapping(
        session, "sleeper", "sheet_rank", "Patric Mahomes", first_pass[0]["normalized_name"], "1"
    )

    second_pass = resolve_rows(session, "sleeper", "sheet_rank", row, PLATFORM_PLAYERS)
    assert second_pass[0]["status"] == AUTO_MATCHED
    assert second_pass[0]["platform_player_id"] == "1"
