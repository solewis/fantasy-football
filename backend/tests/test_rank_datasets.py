import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import rank_datasets
from app.db import Base
from app.matching.mappings import get_mappings
from app.models import PlatformPlayer, RankDatasetEntry
from app.rank_import.parse import ColumnMapping

CSV = """RK,PLAYER NAME,TEAM,POS,TIERS
1,Ja'Marr Chase,CIN,WR1,1
2,Bijan Robinson,ATL,RB1,1
3,Justin Jefferson,MIN,WR2,2
"""


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def seed_players(session: Session, platform: str = "sleeper") -> None:
    session.add_all(
        [
            PlatformPlayer(
                platform=platform,
                platform_player_id="1",
                name="Ja'Marr Chase",
                position="WR",
                team="CIN",
            ),
            PlatformPlayer(
                platform=platform,
                platform_player_id="2",
                name="Bijan Robinson",
                position="RB",
                team="ATL",
            ),
            PlatformPlayer(
                platform=platform,
                platform_player_id="3",
                name="Justin Jefferson",
                position="WR",
                team="MIN",
            ),
        ]
    )
    session.commit()


def test_create_dataset_stores_derived_entries():
    session = make_session()

    dataset = rank_datasets.create_dataset(session, "FantasyPros", "2026", "half_ppr", CSV)

    assert dataset.row_count == 3
    assert dataset.has_overall is True
    assert dataset.has_positional is True
    assert dataset.has_tier is True
    entries = session.query(RankDatasetEntry).filter_by(dataset_id=dataset.id).all()
    by_name = {e.source_name_raw: e for e in entries}
    assert by_name["Ja'Marr Chase"].position == "WR"
    assert by_name["Ja'Marr Chase"].position_rank == 1
    assert by_name["Justin Jefferson"].position_rank == 2
    assert by_name["Bijan Robinson"].tier == 1


def test_create_dataset_rejects_a_duplicate_name_in_the_same_format():
    session = make_session()
    rank_datasets.create_dataset(session, "FantasyPros", "2026", "half_ppr", CSV)

    with pytest.raises(rank_datasets.RankDatasetError):
        rank_datasets.create_dataset(session, "FantasyPros", "2026", "half_ppr", CSV)


def test_create_dataset_rejects_a_file_with_no_usable_rows():
    session = make_session()

    with pytest.raises(rank_datasets.RankDatasetError):
        rank_datasets.create_dataset(session, "Empty", "2026", "half_ppr", "")


def test_reparse_keeps_the_same_id_so_references_survive():
    session = make_session()
    dataset = rank_datasets.create_dataset(session, "FantasyPros", "2026", "half_ppr", CSV)
    original_id = dataset.id

    # Deliberately mis-map: treat the TIERS column as the overall rank.
    reparsed = rank_datasets.reparse_dataset(
        session, dataset.id, ColumnMapping(name=1, team=2, position=3, overall_rank=4)
    )

    assert reparsed.id == original_id
    entries = session.query(RankDatasetEntry).filter_by(dataset_id=original_id).all()
    assert sorted(e.overall_rank for e in entries) == [1, 1, 2]


def test_delete_dataset_removes_its_entries():
    session = make_session()
    dataset = rank_datasets.create_dataset(session, "FantasyPros", "2026", "half_ppr", CSV)

    rank_datasets.delete_dataset(session, dataset.id)

    assert rank_datasets.get_dataset(session, dataset.id) is None
    assert session.query(RankDatasetEntry).filter_by(dataset_id=dataset.id).count() == 0


def test_auto_confirm_persists_exact_matches_and_reports_the_remainder():
    session = make_session()
    seed_players(session)
    dataset = rank_datasets.create_dataset(session, "FantasyPros", "2026", "half_ppr", CSV)

    counts = rank_datasets.auto_confirm_matches(session, dataset.id, "sleeper")

    assert counts == {"matched": 3, "needs_review": 0}
    mappings = get_mappings(
        session,
        "sleeper",
        rank_datasets.RANK_CSV_SOURCE_TYPE,
        ["jamarr chase", "bijan robinson", "justin jefferson"],
    )
    assert len(mappings) == 3


def test_unmatched_names_surface_with_candidates():
    session = make_session()
    seed_players(session)
    dataset = rank_datasets.create_dataset(
        session, "Nicknames", "2026", "half_ppr", "RK,PLAYER NAME,POS\n1,Some Nickname,WR\n"
    )

    unmatched = rank_datasets.list_unmatched(session, dataset.id, "sleeper")

    assert [u["source_name_raw"] for u in unmatched] == ["Some Nickname"]
    assert unmatched[0]["candidates"]


def test_confirming_a_name_clears_it_from_the_review_queue():
    session = make_session()
    seed_players(session)
    dataset = rank_datasets.create_dataset(
        session, "Nicknames", "2026", "half_ppr", "RK,PLAYER NAME,POS\n1,Some Nickname,WR\n"
    )
    unmatched = rank_datasets.list_unmatched(session, dataset.id, "sleeper")

    rank_datasets.confirm_names(
        session,
        "sleeper",
        [{"normalized_name": unmatched[0]["normalized_name"], "platform_player_id": "1"}],
    )

    assert rank_datasets.list_unmatched(session, dataset.id, "sleeper") == []


def test_confirming_no_match_also_clears_the_queue():
    """A confirmed "not a player" has to stick, or the same junk row gets
    re-asked on every import.
    """
    session = make_session()
    seed_players(session)
    dataset = rank_datasets.create_dataset(
        session, "Junk", "2026", "half_ppr", "RK,PLAYER NAME,POS\n1,Total Nonsense,WR\n"
    )
    unmatched = rank_datasets.list_unmatched(session, dataset.id, "sleeper")

    rank_datasets.confirm_names(
        session,
        "sleeper",
        [{"normalized_name": unmatched[0]["normalized_name"], "platform_player_id": None}],
    )

    assert rank_datasets.list_unmatched(session, dataset.id, "sleeper") == []


def test_one_confirmation_serves_every_dataset():
    """Names are keyed by normalized name, not by dataset -- confirming
    "Ja'Marr Chase" once should never be asked again for another file.
    """
    session = make_session()
    seed_players(session)
    first = rank_datasets.create_dataset(
        session, "One", "2026", "half_ppr", "RK,PLAYER NAME,POS\n1,Uncle Rico,WR\n"
    )
    unmatched = rank_datasets.list_unmatched(session, first.id, "sleeper")
    rank_datasets.confirm_names(
        session,
        "sleeper",
        [{"normalized_name": unmatched[0]["normalized_name"], "platform_player_id": "1"}],
    )

    second = rank_datasets.create_dataset(
        session, "Two", "2026", "half_ppr", "RK,PLAYER NAME,POS\n1,Uncle Rico,WR\n"
    )

    assert rank_datasets.list_unmatched(session, second.id, "sleeper") == []
