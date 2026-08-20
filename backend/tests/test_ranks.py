from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import ranks
from app.db import Base
from app.models import AdpEntry, League, PlatformPlayer, RankEntry, RankSet


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


def make_set(session: Session, name: str = "Main", format: str = "half_ppr", **kwargs) -> RankSet:
    return ranks.create_rank_set(session, name, "2026", format, seed_from_adp=False, **kwargs)


def test_create_rank_set_seeds_from_adp_in_ascending_order():
    session = make_session()
    seed_players(session)

    rank_set = ranks.create_rank_set(session, "Main", "2026", "half_ppr", seed_from_adp=True)

    rows = ranks.list_ranks(session, rank_set.id)
    # player 2 has adp 2.0, player 1 has adp 15.0 -- ascending order
    assert [r["platform_player_id"] for r in rows] == ["2", "1"]
    assert [r["rank"] for r in rows] == [1, 2]


def test_create_rank_set_without_seeding_starts_empty():
    session = make_session()
    seed_players(session)

    rank_set = ranks.create_rank_set(session, "Main", "2026", "half_ppr", seed_from_adp=False)

    assert ranks.list_ranks(session, rank_set.id) == []


def test_create_rank_set_rejects_duplicate_name_in_same_scope():
    session = make_session()
    make_set(session, name="Main")

    with pytest.raises(ranks.RankSetError):
        make_set(session, name="Main")


def test_create_rank_set_allows_same_name_across_formats():
    session = make_session()
    make_set(session, name="Main", format="half_ppr")

    # should not raise
    make_set(session, name="Main", format="std")


def test_create_rank_set_rejects_blank_name():
    session = make_session()

    with pytest.raises(ranks.RankSetError):
        make_set(session, name="   ")


def test_rename_rank_set_updates_name():
    session = make_session()
    rank_set = make_set(session, name="Main")

    renamed = ranks.rename_rank_set(session, rank_set.id, "Updated")

    assert renamed.name == "Updated"


def test_rename_rank_set_rejects_duplicate_name_in_scope():
    session = make_session()
    make_set(session, name="Main")
    other = make_set(session, name="Backup")

    with pytest.raises(ranks.RankSetError):
        ranks.rename_rank_set(session, other.id, "Main")


def test_rename_unknown_rank_set_raises():
    session = make_session()

    with pytest.raises(ranks.RankSetError):
        ranks.rename_rank_set(session, 999, "Whatever")


def test_delete_rank_set_removes_entries_too():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")
    ranks.replace_ranks(session, rank_set.id, ["1", "2"])

    ranks.delete_rank_set(session, rank_set.id)

    assert session.get(RankSet, rank_set.id) is None
    assert session.query(RankEntry).filter_by(rank_set_id=rank_set.id).count() == 0


def test_delete_rank_set_nulls_out_leagues_pointing_at_it():
    session = make_session()
    rank_set = make_set(session, name="Main")
    league = League(
        platform="sleeper",
        platform_league_id="999",
        name="Test League",
        season="2026",
        format="half_ppr",
        num_teams=10,
        roster_positions=["QB", "RB"],
        team_names={},
        rank_set_id=rank_set.id,
        created_at=datetime.now(UTC),
    )
    session.add(league)
    session.commit()

    ranks.delete_rank_set(session, rank_set.id)

    session.refresh(league)
    assert league.rank_set_id is None


def test_delete_unknown_rank_set_raises():
    session = make_session()

    with pytest.raises(ranks.RankSetError):
        ranks.delete_rank_set(session, 999)


def test_replace_ranks_then_list_returns_saved_order():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")

    count = ranks.replace_ranks(session, rank_set.id, ["3", "1", "2"])

    assert count == 3
    rows = ranks.list_ranks(session, rank_set.id)
    assert [r["platform_player_id"] for r in rows] == ["3", "1", "2"]
    assert [r["rank"] for r in rows] == [1, 2, 3]
    assert [r["name"] for r in rows] == ["Ja'Marr Chase", "Josh Allen", "Bijan Robinson"]


def test_list_ranks_includes_current_adp_for_reference():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")
    ranks.replace_ranks(session, rank_set.id, ["1", "2"])

    rows = ranks.list_ranks(session, rank_set.id)

    by_id = {r["platform_player_id"]: r["adp"] for r in rows}
    assert by_id["1"] == 15.0
    assert by_id["2"] == 2.0


def test_list_ranks_adp_is_none_when_player_has_no_adp_entry():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")
    ranks.replace_ranks(session, rank_set.id, ["3"])

    rows = ranks.list_ranks(session, rank_set.id)

    assert rows[0]["adp"] is None


def test_list_ranks_for_unknown_set_returns_empty():
    session = make_session()

    assert ranks.list_ranks(session, 999) == []


def test_replace_ranks_fully_replaces_not_accumulates():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")
    ranks.replace_ranks(session, rank_set.id, ["1", "2", "3"])

    ranks.replace_ranks(session, rank_set.id, ["2", "1"])

    rows = ranks.list_ranks(session, rank_set.id)
    assert [r["platform_player_id"] for r in rows] == ["2", "1"]
    assert session.query(RankEntry).filter_by(rank_set_id=rank_set.id).count() == 2


def test_list_rank_sets_scoped_by_format_and_includes_player_count():
    session = make_session()
    seed_players(session)
    half_ppr_set = make_set(session, name="Main", format="half_ppr")
    make_set(session, name="Main", format="std")
    ranks.replace_ranks(session, half_ppr_set.id, ["1", "2"])

    rows = ranks.list_rank_sets(session, season="2026", format="half_ppr")

    assert len(rows) == 1
    assert rows[0]["id"] == half_ppr_set.id
    assert rows[0]["player_count"] == 2


def test_resolve_rank_set_picks_lowest_id_regardless_of_entry_count():
    session = make_session()
    seed_players(session)
    first = make_set(session, name="First")
    second = make_set(session, name="Second")
    # give the second (newer) set more entries than the first
    ranks.replace_ranks(session, second.id, ["1", "2", "3"])

    resolved = ranks.resolve_rank_set(session, "sleeper", "2026", "half_ppr")

    assert resolved is not None
    assert resolved.id == first.id


def test_resolve_rank_set_returns_none_when_no_sets_exist():
    session = make_session()

    assert ranks.resolve_rank_set(session, "sleeper", "2026", "half_ppr") is None
