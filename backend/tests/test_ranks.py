from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.models import AdpEntry, MyRank, PlatformPlayer
from app.ranks import list_my_ranks, replace_my_ranks


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def seed_players(session: Session) -> None:
    session.add_all(
        [
            PlatformPlayer(
                platform="sleeper",
                platform_player_id="1",
                name="Josh Allen",
                position="QB",
                team="BUF",
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
        ]
    )
    session.add_all(
        [
            AdpEntry(
                platform="sleeper",
                platform_player_id="1",
                season="2026",
                format="half_ppr",
                adp=15.0,
            ),
            AdpEntry(
                platform="sleeper",
                platform_player_id="2",
                season="2026",
                format="half_ppr",
                adp=2.0,
            ),
            # no ADP for player 3 in half_ppr -- exercises the outer join returning None
        ]
    )
    session.commit()


def test_list_my_ranks_empty_when_nothing_saved():
    session = make_session()
    seed_players(session)

    rows = list_my_ranks(session, "sleeper", "2026", "half_ppr")

    assert rows == []


def test_replace_my_ranks_then_list_returns_saved_order():
    session = make_session()
    seed_players(session)

    count = replace_my_ranks(session, "sleeper", "2026", "half_ppr", ["3", "1", "2"])

    assert count == 3
    rows = list_my_ranks(session, "sleeper", "2026", "half_ppr")
    assert [r["platform_player_id"] for r in rows] == ["3", "1", "2"]
    assert [r["rank"] for r in rows] == [1, 2, 3]
    assert [r["name"] for r in rows] == ["Ja'Marr Chase", "Josh Allen", "Bijan Robinson"]


def test_list_my_ranks_includes_current_adp_for_reference():
    session = make_session()
    seed_players(session)
    replace_my_ranks(session, "sleeper", "2026", "half_ppr", ["1", "2"])

    rows = list_my_ranks(session, "sleeper", "2026", "half_ppr")

    by_id = {r["platform_player_id"]: r["adp"] for r in rows}
    assert by_id["1"] == 15.0
    assert by_id["2"] == 2.0


def test_list_my_ranks_adp_is_none_when_player_has_no_adp_entry():
    session = make_session()
    seed_players(session)
    replace_my_ranks(session, "sleeper", "2026", "half_ppr", ["3"])

    rows = list_my_ranks(session, "sleeper", "2026", "half_ppr")

    assert rows[0]["adp"] is None


def test_replace_my_ranks_fully_replaces_not_accumulates():
    session = make_session()
    seed_players(session)
    replace_my_ranks(session, "sleeper", "2026", "half_ppr", ["1", "2", "3"])

    replace_my_ranks(session, "sleeper", "2026", "half_ppr", ["2", "1"])

    rows = list_my_ranks(session, "sleeper", "2026", "half_ppr")
    assert [r["platform_player_id"] for r in rows] == ["2", "1"]
    assert session.query(MyRank).count() == 2


def test_replace_my_ranks_scoped_to_format_independently():
    session = make_session()
    seed_players(session)
    replace_my_ranks(session, "sleeper", "2026", "half_ppr", ["1", "2"])

    replace_my_ranks(session, "sleeper", "2026", "std", ["2", "1"])

    half_ppr_rows = list_my_ranks(session, "sleeper", "2026", "half_ppr")
    std_rows = list_my_ranks(session, "sleeper", "2026", "std")
    assert [r["platform_player_id"] for r in half_ppr_rows] == ["1", "2"]
    assert [r["platform_player_id"] for r in std_rows] == ["2", "1"]
