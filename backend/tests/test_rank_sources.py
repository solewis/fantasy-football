import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import rank_datasets, rank_sources
from app.db import Base
from app.models import AdpEntry, PlatformPlayer
from app.ranks import RankEntryInput, create_rank_set, replace_ranks

CSV = """RK,PLAYER NAME,TEAM,POS,TIERS
1,Ja'Marr Chase,CIN,WR1,1
2,Bijan Robinson,ATL,RB1,1
3,Justin Jefferson,MIN,WR2,2
"""

POSITIONAL_ONLY_CSV = """PLAYER NAME,POS RANK,POS
Ja'Marr Chase,1,WR
Justin Jefferson,2,WR
"""


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def seed(session: Session, platform: str = "sleeper", id_prefix: str = "") -> None:
    for pid, name, position, team, adp in [
        ("1", "Ja'Marr Chase", "WR", "CIN", 3.2),
        ("2", "Bijan Robinson", "RB", "ATL", 2.4),
        ("3", "Justin Jefferson", "WR", "MIN", 13.9),
    ]:
        session.add(
            PlatformPlayer(
                platform=platform,
                platform_player_id=f"{id_prefix}{pid}",
                name=name,
                position=position,
                team=team,
            )
        )
        session.add(
            AdpEntry(
                platform=platform,
                platform_player_id=f"{id_prefix}{pid}",
                season="2026",
                format="half_ppr",
                adp=adp,
            )
        )
    session.commit()


def import_and_resolve(session: Session, name: str, csv: str, platform: str = "sleeper"):
    dataset = rank_datasets.create_dataset(session, name, "2026", "half_ppr", csv)
    rank_datasets.auto_confirm_matches(session, dataset.id, platform)
    return dataset


def test_adp_source_ranks_are_ordinals_not_the_adp_floats():
    """Comparing an ADP of 2.4 against "slot 3 in my list" compares an estimated
    pick number to a list index. Ranking the ADP order first makes it
    comparable to every other source.
    """
    session = make_session()
    seed(session)

    source = rank_sources.load_rank_source(session, "adp", "sleeper", "2026", "half_ppr")

    assert sorted(r.overall_rank for r in source.ranks.values()) == [1, 2, 3]
    # Bijan has the lowest ADP (2.4), so he is overall rank 1
    assert source.ranks["2"].overall_rank == 1
    assert source.ranks["1"].overall_rank == 2


def test_adp_source_also_supplies_dense_positional_ranks():
    session = make_session()
    seed(session)

    source = rank_sources.load_rank_source(session, "adp", "sleeper", "2026", "half_ppr")

    assert source.ranks["1"].position_rank == 1  # Chase, WR
    assert source.ranks["3"].position_rank == 2  # Jefferson, WR
    assert source.ranks["2"].position_rank == 1  # Bijan, RB


def test_dataset_source_resolves_names_through_confirmed_mappings():
    session = make_session()
    seed(session)
    dataset = import_and_resolve(session, "FantasyPros", CSV)

    source = rank_sources.load_rank_source(
        session, f"dataset:{dataset.id}", "sleeper", "2026", "half_ppr"
    )

    assert source.ranks["1"].overall_rank == 1
    assert source.ranks["1"].tier == 1
    assert source.unresolved == []


def test_dataset_source_reports_unresolved_names_rather_than_guessing():
    session = make_session()
    seed(session)
    dataset = import_and_resolve(session, "Nicknames", "RK,PLAYER NAME,POS\n1,Uncle Rico,WR\n")

    source = rank_sources.load_rank_source(
        session, f"dataset:{dataset.id}", "sleeper", "2026", "half_ppr"
    )

    assert source.ranks == {}
    assert source.unresolved == ["Uncle Rico"]


def test_the_same_dataset_resolves_differently_per_platform():
    """The whole payoff of storing datasets by normalized name: one upload
    serves both a Sleeper and an ESPN league.
    """
    session = make_session()
    seed(session, platform="sleeper")
    seed(session, platform="espn", id_prefix="e")
    dataset = rank_datasets.create_dataset(session, "FantasyPros", "2026", "half_ppr", CSV)
    rank_datasets.auto_confirm_matches(session, dataset.id, "sleeper")
    rank_datasets.auto_confirm_matches(session, dataset.id, "espn")

    sleeper = rank_sources.load_rank_source(
        session, f"dataset:{dataset.id}", "sleeper", "2026", "half_ppr"
    )
    espn = rank_sources.load_rank_source(
        session, f"dataset:{dataset.id}", "espn", "2026", "half_ppr"
    )

    assert set(sleeper.ranks) == {"1", "2", "3"}
    assert set(espn.ranks) == {"e1", "e2", "e3"}
    assert sleeper.ranks["1"].overall_rank == espn.ranks["e1"].overall_rank


def test_positional_rank_set_cannot_feed_an_overall_build():
    session = make_session()
    seed(session)
    wr_set = create_rank_set(session, "My WRs", "2026", "half_ppr", scope="WR", seed_from_adp=False)
    replace_ranks(session, wr_set.id, [RankEntryInput(platform_player_id="1")])

    source = rank_sources.load_rank_source(
        session, f"rank_set:{wr_set.id}", "sleeper", "2026", "half_ppr"
    )
    assert source.supports_overall is False

    with pytest.raises(rank_sources.RankSourceError):
        rank_sources.load_rank_sources(
            session, [f"rank_set:{wr_set.id}"], "sleeper", "2026", "half_ppr", scope="overall"
        )


def test_positional_only_dataset_cannot_feed_an_overall_build():
    session = make_session()
    seed(session)
    dataset = import_and_resolve(session, "WR only", POSITIONAL_ONLY_CSV)

    with pytest.raises(rank_sources.RankSourceError):
        rank_sources.load_rank_sources(
            session, [f"dataset:{dataset.id}"], "sleeper", "2026", "half_ppr", scope="overall"
        )


def test_build_rank_pool_reports_a_missing_player_as_none_never_a_number():
    """An imputed rank is indistinguishable from a real one a few functions
    later, and the UI has to be able to say "3 of 4 sources" honestly.
    """
    session = make_session()
    seed(session)
    partial = import_and_resolve(session, "Partial", "RK,PLAYER NAME,POS\n1,Ja'Marr Chase,WR\n")

    pool = rank_sources.build_rank_pool(
        session, ["adp", f"dataset:{partial.id}"], "sleeper", "2026", "half_ppr"
    )

    by_name = {p["name"]: p for p in pool["players"]}
    assert by_name["Ja'Marr Chase"]["ranks"][f"dataset:{partial.id}"] == 1
    assert by_name["Bijan Robinson"]["ranks"][f"dataset:{partial.id}"] is None
    assert by_name["Bijan Robinson"]["ranks"]["adp"] == 1


def test_build_rank_pool_for_a_position_only_includes_that_position():
    session = make_session()
    seed(session)

    pool = rank_sources.build_rank_pool(session, ["adp"], "sleeper", "2026", "half_ppr", scope="WR")

    assert {p["position"] for p in pool["players"]} == {"WR"}
    assert {p["ranks"]["adp"] for p in pool["players"]} == {1, 2}


def test_build_rank_pool_reports_source_depth():
    """ "Only ranks 150 players" is a different fact from "left this player
    off", and at slot 200 everything would otherwise read as disagreement.
    """
    session = make_session()
    seed(session)
    partial = import_and_resolve(session, "Partial", "RK,PLAYER NAME,POS\n1,Ja'Marr Chase,WR\n")

    pool = rank_sources.build_rank_pool(
        session, ["adp", f"dataset:{partial.id}"], "sleeper", "2026", "half_ppr"
    )

    depths = {s["ref"]: s["depth"] for s in pool["sources"]}
    assert depths["adp"] == 3
    assert depths[f"dataset:{partial.id}"] == 1


def test_list_available_sources_marks_what_each_can_serve():
    session = make_session()
    seed(session)
    import_and_resolve(session, "WR only", POSITIONAL_ONLY_CSV)
    create_rank_set(session, "My WRs", "2026", "half_ppr", scope="WR", seed_from_adp=False)

    sources = rank_sources.list_available_sources(session, "sleeper", "2026", "half_ppr")

    by_label = {s["label"]: s for s in sources}
    assert by_label["ADP"]["supports_overall"] is True
    assert by_label["WR only"]["supports_overall"] is False
    assert by_label["WR only"]["supports_positional"] is True
    assert by_label["My WRs"]["supports_overall"] is False


def test_list_available_sources_reports_is_active_for_positional_sets_only():
    session = make_session()
    seed(session)
    create_rank_set(session, "Main", "2026", "half_ppr", seed_from_adp=False)
    create_rank_set(session, "My WRs", "2026", "half_ppr", scope="WR", seed_from_adp=False)

    sources = rank_sources.list_available_sources(session, "sleeper", "2026", "half_ppr")

    by_label = {s["label"]: s for s in sources}
    assert by_label["ADP"]["is_active"] is None
    # Overall sets have no ambiguity to disambiguate -- is_active doesn't apply.
    assert by_label["Main"]["is_active"] is None
    # The only WR set that exists becomes active automatically on creation.
    assert by_label["My WRs"]["is_active"] is True
