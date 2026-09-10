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


def entries(platform_player_ids: list[str]) -> list[ranks.RankEntryInput]:
    """Most of these tests are about ordering, not tiers -- this keeps their
    call sites reading as a plain list of ids."""
    return [ranks.RankEntryInput(platform_player_id=pid) for pid in platform_player_ids]


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
    ranks.replace_ranks(session, rank_set.id, entries(["1", "2"]))

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

    count = ranks.replace_ranks(session, rank_set.id, entries(["3", "1", "2"]))

    assert count == 3
    rows = ranks.list_ranks(session, rank_set.id)
    assert [r["platform_player_id"] for r in rows] == ["3", "1", "2"]
    assert [r["rank"] for r in rows] == [1, 2, 3]
    assert [r["name"] for r in rows] == ["Ja'Marr Chase", "Josh Allen", "Bijan Robinson"]


def test_list_ranks_includes_current_adp_for_reference():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")
    ranks.replace_ranks(session, rank_set.id, entries(["1", "2"]))

    rows = ranks.list_ranks(session, rank_set.id)

    by_id = {r["platform_player_id"]: r["adp"] for r in rows}
    assert by_id["1"] == 15.0
    assert by_id["2"] == 2.0


def test_list_ranks_adp_is_none_when_player_has_no_adp_entry():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")
    ranks.replace_ranks(session, rank_set.id, entries(["3"]))

    rows = ranks.list_ranks(session, rank_set.id)

    assert rows[0]["adp"] is None


def test_list_ranks_for_unknown_set_returns_empty():
    session = make_session()

    assert ranks.list_ranks(session, 999) == []


def test_replace_ranks_fully_replaces_not_accumulates():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")
    ranks.replace_ranks(session, rank_set.id, entries(["1", "2", "3"]))

    ranks.replace_ranks(session, rank_set.id, entries(["2", "1"]))

    rows = ranks.list_ranks(session, rank_set.id)
    assert [r["platform_player_id"] for r in rows] == ["2", "1"]
    assert session.query(RankEntry).filter_by(rank_set_id=rank_set.id).count() == 2


def test_list_rank_sets_scoped_by_format_and_includes_player_count():
    session = make_session()
    seed_players(session)
    half_ppr_set = make_set(session, name="Main", format="half_ppr")
    make_set(session, name="Main", format="std")
    ranks.replace_ranks(session, half_ppr_set.id, entries(["1", "2"]))

    rows = ranks.list_rank_sets(session, season="2026", format="half_ppr")

    assert len(rows) == 1
    assert rows[0]["id"] == half_ppr_set.id
    assert rows[0]["player_count"] == 2


def test_resolve_rank_set_picks_the_active_set_regardless_of_entry_count():
    session = make_session()
    seed_players(session)
    first = make_set(session, name="First")
    second = make_set(session, name="Second")
    # give the second (newer) set more entries than the first
    ranks.replace_ranks(session, second.id, entries(["1", "2", "3"]))

    resolved = ranks.resolve_rank_set(session, "sleeper", "2026", "half_ppr")

    # The first overall set created is the active one by default, so it wins
    # even though the second has more entries -- entry count was never the
    # rule, and this pins that down explicitly.
    assert resolved is not None
    assert resolved.id == first.id


def test_resolve_rank_set_picks_whichever_overall_set_is_active():
    session = make_session()
    seed_players(session)
    first = make_set(session, name="First")
    second = make_set(session, name="Second")
    assert first.is_active is True
    assert second.is_active is False

    ranks.set_active_rank_set(session, second.id)
    resolved = ranks.resolve_rank_set(session, "sleeper", "2026", "half_ppr")

    # An ad-hoc draft has no League to assign a rank_set_id from, so this is
    # the only way a user with two overall lists can choose which one it
    # uses -- switching the active flag must actually switch the resolver's
    # answer, not just cosmetically flip a flag nothing reads.
    assert resolved is not None
    assert resolved.id == second.id


def test_resolve_rank_set_falls_back_to_lowest_id_when_none_are_active():
    # Only reachable for data older than the active flag -- a fresh
    # create_rank_set always sets it on a scope's first set. Guards that
    # such data doesn't strand the resolver with nothing to return.
    session = make_session()
    seed_players(session)
    first = make_set(session, name="First")
    make_set(session, name="Second")
    session.query(RankSet).update({"is_active": False})
    session.commit()

    resolved = ranks.resolve_rank_set(session, "sleeper", "2026", "half_ppr")

    assert resolved is not None
    assert resolved.id == first.id


def test_resolve_rank_set_returns_none_when_no_sets_exist():
    session = make_session()

    assert ranks.resolve_rank_set(session, "sleeper", "2026", "half_ppr") is None


def test_create_rank_set_with_positional_scope_seeds_only_that_position():
    session = make_session()
    seed_players(session)

    # RB rather than WR because seeding inner-joins ADP, and the fixture's only
    # WR deliberately has no half_ppr ADP row.
    rank_set = ranks.create_rank_set(
        session, "My RBs", "2026", "half_ppr", scope="RB", seed_from_adp=True
    )

    rows = ranks.list_ranks(session, rank_set.id)
    assert [r["name"] for r in rows] == ["Bijan Robinson"]


def test_create_rank_set_allows_the_same_name_across_scopes():
    session = make_session()
    make_set(session, name="Main")

    # should not raise -- "Main" the overall list and "Main" the WR list are
    # different lists, which is why scope is part of the unique key
    make_set(session, name="Main", scope="WR")


def test_create_rank_set_rejects_duplicate_name_within_a_scope():
    session = make_session()
    make_set(session, name="Main", scope="WR")

    with pytest.raises(ranks.RankSetError):
        make_set(session, name="Main", scope="WR")


def test_create_rank_set_rejects_an_unknown_scope():
    session = make_session()

    for bad in ("K", "DEF", "FLEX", "overall_", ""):
        with pytest.raises(ranks.RankSetError):
            make_set(session, name=f"Set {bad}", scope=bad)


def test_list_rank_sets_can_filter_by_scope():
    session = make_session()
    make_set(session, name="Main")
    make_set(session, name="My WRs", scope="WR")

    overall = ranks.list_rank_sets(session, "sleeper", "2026", "half_ppr", scope="overall")
    wr = ranks.list_rank_sets(session, "sleeper", "2026", "half_ppr", scope="WR")

    assert [s["name"] for s in overall] == ["Main"]
    assert [s["name"] for s in wr] == ["My WRs"]
    assert wr[0]["scope"] == "WR"


def test_replace_ranks_round_trips_tiers():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")

    ranks.replace_ranks(
        session,
        rank_set.id,
        [
            ranks.RankEntryInput(platform_player_id="3", tier=1),
            ranks.RankEntryInput(platform_player_id="1", tier=1),
            ranks.RankEntryInput(platform_player_id="2", tier=2),
        ],
    )

    rows = ranks.list_ranks(session, rank_set.id)
    assert [r["tier"] for r in rows] == [1, 1, 2]


def test_replace_ranks_leaves_tier_none_when_not_given():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")

    ranks.replace_ranks(session, rank_set.id, entries(["1", "2"]))

    assert [r["tier"] for r in ranks.list_ranks(session, rank_set.id)] == [None, None]


def test_resolve_rank_set_skips_positional_sets_even_at_a_lower_id():
    """Regression guard for a silent, nasty failure: the draft player pool
    resolves "the ranks for this format" through this function, so a positional
    set winning here would show a board of nothing but receivers, with no error
    anywhere.
    """
    session = make_session()
    wr_set = make_set(session, name="My WRs", scope="WR")
    overall_set = make_set(session, name="Main")
    assert wr_set.id < overall_set.id

    resolved = ranks.resolve_rank_set(session, "sleeper", "2026", "half_ppr")

    assert resolved is not None
    assert resolved.id == overall_set.id


def test_resolve_rank_set_returns_none_when_only_positional_sets_exist():
    session = make_session()
    make_set(session, name="My WRs", scope="WR")

    assert ranks.resolve_rank_set(session, "sleeper", "2026", "half_ppr") is None


def test_replace_ranks_round_trips_break_strength_and_flags():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")

    ranks.replace_ranks(
        session,
        rank_set.id,
        [
            ranks.RankEntryInput(platform_player_id="3", tier=1, break_after="major"),
            ranks.RankEntryInput(platform_player_id="1", tier=2, flag="target"),
            ranks.RankEntryInput(platform_player_id="2", tier=2, flag="fade"),
        ],
    )

    rows = ranks.list_ranks(session, rank_set.id)
    assert [r["break_after"] for r in rows] == ["major", None, None]
    assert [r["flag"] for r in rows] == [None, "target", "fade"]


def test_replace_ranks_rejects_an_unknown_break_strength():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")

    with pytest.raises(ranks.RankSetError):
        ranks.replace_ranks(
            session,
            rank_set.id,
            [ranks.RankEntryInput(platform_player_id="1", break_after="huge")],
        )


def test_replace_ranks_rejects_an_unknown_flag():
    session = make_session()
    seed_players(session)
    rank_set = make_set(session, name="Main")

    with pytest.raises(ranks.RankSetError):
        ranks.replace_ranks(
            session,
            rank_set.id,
            [ranks.RankEntryInput(platform_player_id="1", flag="maybe")],
        )


def test_create_rank_set_first_positional_set_is_active_by_default():
    session = make_session()

    rank_set = make_set(session, name="My QBs", scope="QB")

    assert rank_set.is_active is True


def test_create_rank_set_second_positional_set_starts_inactive():
    session = make_session()
    make_set(session, name="My QBs", scope="QB")

    second = make_set(session, name="QB backup", scope="QB")

    assert second.is_active is False


def test_create_rank_set_first_overall_set_is_active_by_default():
    # Matches positional scopes: an ad-hoc draft has no League to assign a
    # rank_set_id from, so this is what lets resolve_rank_set find a set at
    # all without the old, arbitrary "lowest id" tiebreak.
    session = make_session()

    rank_set = make_set(session, name="Main")

    assert rank_set.is_active is True


def test_create_rank_set_second_overall_set_starts_inactive():
    session = make_session()
    make_set(session, name="Main")

    second = make_set(session, name="Draft night experiment")

    assert second.is_active is False


def test_create_rank_set_active_by_position_is_independent():
    session = make_session()
    make_set(session, name="My QBs", scope="QB")

    # QB already has an active set -- RB doesn't, so its first set still
    # becomes active. Positions must not share one global "has any active" flag.
    rb_set = make_set(session, name="My RBs", scope="RB")

    assert rb_set.is_active is True


def test_set_active_rank_set_deactivates_the_previous_one():
    session = make_session()
    first = make_set(session, name="My QBs", scope="QB")
    second = make_set(session, name="QB backup", scope="QB")
    assert first.is_active is True
    assert second.is_active is False

    activated = ranks.set_active_rank_set(session, second.id)

    assert activated.is_active is True
    session.refresh(first)
    assert first.is_active is False


def test_set_active_rank_set_works_for_overall_scope_too():
    session = make_session()
    first = make_set(session, name="Main")
    second = make_set(session, name="Draft night experiment")
    assert first.is_active is True
    assert second.is_active is False

    activated = ranks.set_active_rank_set(session, second.id)

    assert activated.is_active is True
    session.refresh(first)
    assert first.is_active is False


def test_set_active_rank_set_rejects_unknown_id():
    session = make_session()

    with pytest.raises(ranks.RankSetError):
        ranks.set_active_rank_set(session, 999)


def test_delete_rank_set_promotes_another_set_when_active_one_is_deleted():
    session = make_session()
    first = make_set(session, name="My QBs", scope="QB")
    second = make_set(session, name="QB backup", scope="QB")
    assert first.is_active is True

    ranks.delete_rank_set(session, first.id)

    session.refresh(second)
    assert second.is_active is True


def test_delete_rank_set_leaves_no_active_set_when_it_was_the_only_one():
    session = make_session()
    rank_set = make_set(session, name="My QBs", scope="QB")

    # Should not raise even though nothing is left to promote.
    ranks.delete_rank_set(session, rank_set.id)

    assert ranks.list_rank_sets(session, "sleeper", "2026", "half_ppr", scope="QB") == []


def test_list_rank_sets_includes_is_active():
    session = make_session()
    make_set(session, name="My QBs", scope="QB")

    rows = ranks.list_rank_sets(session, "sleeper", "2026", "half_ppr", scope="QB")

    assert rows[0]["is_active"] is True
