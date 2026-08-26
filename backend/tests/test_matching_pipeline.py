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


def test_resolve_rows_flags_unknown_name_then_reuses_confirmation_on_rerun():
    """A nickname no fuzzy score can reach still needs a human once -- and only
    once, which is the whole point of persisting the decision.
    """
    session = make_session()
    row = [{"name": "Showtime", "position": "QB"}]

    first_pass = resolve_rows(session, "sleeper", "sheet_rank", row, PLATFORM_PLAYERS)
    assert first_pass[0]["status"] == NEEDS_REVIEW

    confirm_mapping(
        session, "sleeper", "sheet_rank", "Showtime", first_pass[0]["normalized_name"], "1"
    )

    second_pass = resolve_rows(session, "sleeper", "sheet_rank", row, PLATFORM_PLAYERS)
    assert second_pass[0]["status"] == AUTO_MATCHED
    assert second_pass[0]["platform_player_id"] == "1"


def test_resolve_rows_carries_the_source_row_through():
    """The importer needs rank/tier/row_index to survive resolution -- without
    passthrough it would have to re-associate results with inputs by list
    position, which is exactly how things silently misalign.
    """
    session = make_session()

    results = resolve_rows(
        session,
        "sleeper",
        "sheet_rank",
        [{"name": "Patrick Mahomes", "position": "QB", "overall_rank": 12, "tier": 2}],
        PLATFORM_PLAYERS,
    )

    assert results[0]["overall_rank"] == 12
    assert results[0]["tier"] == 2
    assert results[0]["status"] == AUTO_MATCHED


def test_resolve_rows_ignores_non_fantasy_positions():
    """Sleeper's list carries 1,162 linebackers; fuzzy-matching a WR against a
    similarly-named long snapper is how you get a confidently wrong match.
    """
    session = make_session()
    players = [
        *PLATFORM_PLAYERS,
        {"platform_player_id": "99", "name": "Patrick Mahome", "position": "LB", "team": "NYJ"},
    ]

    results = resolve_rows(
        session, "sleeper", "sheet_rank", [{"name": "Patrick Mahomes", "position": "QB"}], players
    )

    assert results[0]["platform_player_id"] == "1"
