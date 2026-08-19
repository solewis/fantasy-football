from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.models import AdpEntry, PlatformPlayer
from app.players import list_players


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def seed(session: Session) -> None:
    players = [
        PlatformPlayer(
            platform="sleeper", platform_player_id="1", name="Josh Allen", position="QB", team="BUF"
        ),
        PlatformPlayer(
            platform="sleeper",
            platform_player_id="2",
            name="Bijan Robinson",
            position="RB",
            team="ATL",
        ),
        PlatformPlayer(
            platform="sleeper",
            platform_player_id="3",
            name="Ja'Marr Chase",
            position="WR",
            team="CIN",
        ),
        # no ADP entry at all -- should never appear
        PlatformPlayer(
            platform="sleeper",
            platform_player_id="4",
            name="Deep Bench Guy",
            position="RB",
            team="KC",
        ),
        # different platform, same id space -- must not leak into sleeper results
        PlatformPlayer(
            platform="espn", platform_player_id="1", name="Josh Allen", position="QB", team="BUF"
        ),
    ]
    session.add_all(players)

    adp_entries = [
        AdpEntry(
            platform="sleeper", platform_player_id="1", season="2026", format="half_ppr", adp=15.0
        ),
        AdpEntry(
            platform="sleeper", platform_player_id="2", season="2026", format="half_ppr", adp=2.0
        ),
        AdpEntry(
            platform="sleeper", platform_player_id="3", season="2026", format="half_ppr", adp=1.0
        ),
        # only in std format, not half_ppr
        AdpEntry(platform="sleeper", platform_player_id="1", season="2026", format="std", adp=20.0),
        AdpEntry(
            platform="espn", platform_player_id="1", season="2026", format="half_ppr", adp=99.0
        ),
    ]
    session.add_all(adp_entries)
    session.commit()


def test_list_players_sorted_by_adp_ascending():
    session = make_session()
    seed(session)

    rows = list_players(session, "sleeper", "2026", "half_ppr")

    assert [r["name"] for r in rows] == ["Ja'Marr Chase", "Bijan Robinson", "Josh Allen"]


def test_list_players_excludes_players_without_adp_in_requested_format():
    session = make_session()
    seed(session)

    rows = list_players(session, "sleeper", "2026", "half_ppr")

    names = {r["name"] for r in rows}
    assert "Deep Bench Guy" not in names


def test_list_players_scoped_to_platform():
    session = make_session()
    seed(session)

    rows = list_players(session, "sleeper", "2026", "half_ppr")

    assert len(rows) == 3
    assert all(r["platform_player_id"] != "99" for r in rows)


def test_list_players_filters_by_position():
    session = make_session()
    seed(session)

    rows = list_players(session, "sleeper", "2026", "half_ppr", position="RB")

    assert [r["name"] for r in rows] == ["Bijan Robinson"]


def test_list_players_search_is_case_insensitive_substring():
    session = make_session()
    seed(session)

    rows = list_players(session, "sleeper", "2026", "half_ppr", search="josh")

    assert [r["name"] for r in rows] == ["Josh Allen"]


def test_list_players_different_format_returns_different_set():
    session = make_session()
    seed(session)

    rows = list_players(session, "sleeper", "2026", "std")

    assert [r["name"] for r in rows] == ["Josh Allen"]
