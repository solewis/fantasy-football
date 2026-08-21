from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import draft
from app.db import Base
from app.ingest import sleeper_draft, sleeper_league
from app.models import Draft, DraftPick, DraftQueueEntry, League, PlatformPlayer


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def seed_players(session: Session, count: int = 4) -> None:
    names = [
        "Josh Allen",
        "Bijan Robinson",
        "Ja'Marr Chase",
        "Sam LaPorta",
        "Extra Guy",
        "Another Guy",
    ]
    positions = ["QB", "RB", "WR", "TE", "RB", "WR"]
    for i in range(count):
        session.add(
            PlatformPlayer(
                platform="sleeper",
                platform_player_id=str(i + 1),
                name=names[i],
                position=positions[i],
                team="XXX",
            )
        )
    session.commit()


def make_small_draft(session: Session, num_teams: int = 2, num_rounds: int = 2, my_slot: int = 1):
    return draft.create_draft(
        session,
        season="2026",
        format="half_ppr",
        num_teams=num_teams,
        num_rounds=num_rounds,
        my_slot=my_slot,
    )


def make_league(
    session: Session,
    format: str = "half_ppr",
    roster_positions: list | None = None,
    team_names: dict | None = None,
    rank_set_id: int | None = None,
) -> League:
    league = League(
        platform="sleeper",
        platform_league_id="777",
        name="Test League",
        season="2026",
        format=format,
        num_teams=2,
        roster_positions=roster_positions or ["QB", "RB"],
        team_names=team_names or {},
        rank_set_id=rank_set_id,
        created_at=datetime.now(UTC),
    )
    session.add(league)
    session.commit()
    session.refresh(league)
    return league


def test_create_draft_persists_settings():
    session = make_session()

    created = make_small_draft(session, num_teams=10, num_rounds=14, my_slot=3)

    fetched = draft.get_draft(session, created.id)
    assert fetched is not None
    assert fetched.num_teams == 10
    assert fetched.num_rounds == 14
    assert fetched.my_slot == 3


def test_list_picks_empty_for_new_draft():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session)

    assert draft.list_picks(session, created.id) == []


def test_make_pick_assigns_sequential_pick_numbers_and_round_slot():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session, num_teams=2, num_rounds=2)

    first = draft.make_pick(session, created.id, "1")
    second = draft.make_pick(session, created.id, "2")

    assert first == {"pick_number": 1}
    assert second == {"pick_number": 2}

    picks = draft.list_picks(session, created.id)
    assert [p["platform_player_id"] for p in picks] == ["1", "2"]
    assert picks[0]["round"] == 1 and picks[0]["slot"] == 1
    assert picks[1]["round"] == 1 and picks[1]["slot"] == 2


def test_make_pick_rejects_same_player_twice():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session, num_teams=2, num_rounds=2)
    draft.make_pick(session, created.id, "1")

    try:
        draft.make_pick(session, created.id, "1")
        raise AssertionError("expected DraftError")
    except draft.DraftError:
        pass

    assert session.query(DraftPick).count() == 1


def test_make_pick_rejects_when_draft_is_complete():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session, num_teams=2, num_rounds=2)  # 4 total picks
    for pid in ["1", "2", "3", "4"]:
        draft.make_pick(session, created.id, pid)

    try:
        draft.make_pick(session, created.id, "5")
        raise AssertionError("expected DraftError")
    except draft.DraftError:
        pass


def test_make_pick_removes_player_from_queue():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session, num_teams=2, num_rounds=2)
    draft.replace_queue(session, created.id, ["1", "2"])

    draft.make_pick(session, created.id, "1")

    remaining = draft.list_queue(session, created.id)
    assert [r["platform_player_id"] for r in remaining] == ["2"]


def test_undo_last_pick_removes_most_recent_pick_only():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session, num_teams=2, num_rounds=2)
    draft.make_pick(session, created.id, "1")
    draft.make_pick(session, created.id, "2")

    undone = draft.undo_last_pick(session, created.id)

    assert undone == {"pick_number": 2, "platform_player_id": "2"}
    remaining = draft.list_picks(session, created.id)
    assert [p["platform_player_id"] for p in remaining] == ["1"]


def test_undo_last_pick_on_empty_draft_returns_none():
    session = make_session()
    created = make_small_draft(session)

    assert draft.undo_last_pick(session, created.id) is None


def test_get_status_reflects_whose_turn_and_completion():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session, num_teams=2, num_rounds=2, my_slot=2)  # 4 total picks

    status = draft.get_status(session, created.id)
    assert status["next_pick_number"] == 1
    assert status["current_round"] == 1
    assert status["current_slot"] == 1
    assert status["is_my_turn"] is False
    assert status["is_complete"] is False

    draft.make_pick(session, created.id, "1")  # pick 1, slot 1

    status = draft.get_status(session, created.id)
    assert status["next_pick_number"] == 2
    assert status["current_slot"] == 2
    assert status["is_my_turn"] is True  # my_slot is 2

    for pid in ["2", "3", "4"]:
        draft.make_pick(session, created.id, pid)

    status = draft.get_status(session, created.id)
    assert status["is_complete"] is True
    assert status["next_pick_number"] is None
    assert status["current_round"] is None
    assert status["is_my_turn"] is False


def test_get_status_for_unknown_draft_returns_none():
    session = make_session()

    assert draft.get_status(session, 999) is None


def test_list_queue_empty_by_default():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session)

    assert draft.list_queue(session, created.id) == []


def test_replace_queue_then_list_returns_saved_order():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session)

    count = draft.replace_queue(session, created.id, ["2", "1"])

    assert count == 2
    rows = draft.list_queue(session, created.id)
    assert [r["platform_player_id"] for r in rows] == ["2", "1"]


def test_replace_queue_fully_replaces_not_accumulates():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session)
    draft.replace_queue(session, created.id, ["1", "2", "3"])

    draft.replace_queue(session, created.id, ["3"])

    assert session.query(DraftQueueEntry).count() == 1
    rows = draft.list_queue(session, created.id)
    assert [r["platform_player_id"] for r in rows] == ["3"]


def test_queues_are_scoped_per_draft():
    session = make_session()
    seed_players(session)
    draft_a = make_small_draft(session)
    draft_b = make_small_draft(session)
    draft.replace_queue(session, draft_a.id, ["1"])
    draft.replace_queue(session, draft_b.id, ["2"])

    assert [r["platform_player_id"] for r in draft.list_queue(session, draft_a.id)] == ["1"]
    assert [r["platform_player_id"] for r in draft.list_queue(session, draft_b.id)] == ["2"]


def test_create_sleeper_draft_uses_settings_from_sleeper(monkeypatch):
    session = make_session()
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 8, "rounds": 12}},
    )

    created = draft.create_sleeper_draft(session, "999", format="ppr", my_slot=4)

    assert created.platform == "sleeper"
    assert created.platform_draft_id == "999"
    assert created.season == "2026"
    assert created.num_teams == 8
    assert created.num_rounds == 12
    assert created.my_slot == 4


def test_create_sleeper_draft_raises_draft_error_on_fetch_failure(monkeypatch):
    session = make_session()

    def boom(draft_id):
        raise sleeper_draft.SleeperFetchError("no such draft")

    monkeypatch.setattr(sleeper_draft, "fetch_raw_draft", boom)

    with pytest.raises(draft.DraftError):
        draft.create_sleeper_draft(session, "bad-id", format="ppr", my_slot=1)


def test_sync_sleeper_draft_inserts_new_picks(monkeypatch):
    session = make_session()
    seed_players(session)
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    created = draft.create_sleeper_draft(session, "999", format="half_ppr", my_slot=1)

    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_picks",
        lambda draft_id: [
            {"pick_no": 1, "player_id": "1"},
            {"pick_no": 2, "player_id": "2"},
        ],
    )

    status = draft.sync_sleeper_draft(session, created.id)

    assert [p["platform_player_id"] for p in status["picks"]] == ["1", "2"]


def test_sync_sleeper_draft_is_idempotent(monkeypatch):
    session = make_session()
    seed_players(session)
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    created = draft.create_sleeper_draft(session, "999", format="half_ppr", my_slot=1)
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_picks",
        lambda draft_id: [{"pick_no": 1, "player_id": "1"}],
    )

    draft.sync_sleeper_draft(session, created.id)
    draft.sync_sleeper_draft(session, created.id)

    assert session.query(DraftPick).filter_by(draft_id=created.id).count() == 1


def test_sync_sleeper_draft_removes_synced_players_from_queue(monkeypatch):
    session = make_session()
    seed_players(session)
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    created = draft.create_sleeper_draft(session, "999", format="half_ppr", my_slot=1)
    draft.replace_queue(session, created.id, ["1", "2"])
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_picks",
        lambda draft_id: [{"pick_no": 1, "player_id": "1"}],
    )

    draft.sync_sleeper_draft(session, created.id)

    remaining = draft.list_queue(session, created.id)
    assert [r["platform_player_id"] for r in remaining] == ["2"]


def test_sync_sleeper_draft_rejects_manual_draft():
    session = make_session()
    created = make_small_draft(session)

    with pytest.raises(draft.DraftError):
        draft.sync_sleeper_draft(session, created.id)


def test_make_pick_rejects_on_sleeper_synced_draft(monkeypatch):
    session = make_session()
    seed_players(session)
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    created = draft.create_sleeper_draft(session, "999", format="half_ppr", my_slot=1)

    with pytest.raises(draft.DraftError):
        draft.make_pick(session, created.id, "1")


def test_undo_last_pick_rejects_on_sleeper_synced_draft(monkeypatch):
    session = make_session()
    seed_players(session)
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    created = draft.create_sleeper_draft(session, "999", format="half_ppr", my_slot=1)

    with pytest.raises(draft.DraftError):
        draft.undo_last_pick(session, created.id)


def test_switch_to_manual_allows_manual_picks_again(monkeypatch):
    session = make_session()
    seed_players(session)
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    created = draft.create_sleeper_draft(session, "999", format="half_ppr", my_slot=1)

    status = draft.switch_to_manual(session, created.id)

    assert status["draft"]["platform"] == "manual"
    result = draft.make_pick(session, created.id, "1")
    assert result == {"pick_number": 1}


def test_create_draft_from_league_uses_leagues_current_draft_id(monkeypatch):
    session = make_session()
    league = make_league(session, team_names={"10": "My Team", "3": "Rival"})
    monkeypatch.setattr(sleeper_league, "fetch_raw_league", lambda league_id: {"draft_id": "555"})
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {
            "season": "2026",
            "settings": {"teams": 2, "rounds": 2},
            "slot_to_roster_id": {"1": 10, "2": 3},
        },
    )

    created = draft.create_draft_from_league(session, league.id, my_slot=1)

    assert created.platform == "sleeper"
    assert created.platform_draft_id == "555"
    assert created.league_id == league.id
    assert created.format == "half_ppr"
    assert created.num_teams == 2
    assert created.num_rounds == 2
    assert created.my_slot == 1
    assert created.team_names == {"1": "My Team", "2": "Rival"}


def test_create_draft_from_league_raises_when_league_not_found():
    session = make_session()

    with pytest.raises(draft.DraftError):
        draft.create_draft_from_league(session, 999, my_slot=1)


def test_create_draft_from_league_raises_when_slot_out_of_range():
    session = make_session()
    league = make_league(session)  # num_teams defaults to 2

    with pytest.raises(draft.DraftError, match="between 1 and 2"):
        draft.create_draft_from_league(session, league.id, my_slot=3)

    with pytest.raises(draft.DraftError, match="between 1 and 2"):
        draft.create_draft_from_league(session, league.id, my_slot=0)


def test_create_draft_from_league_raises_when_no_active_draft(monkeypatch):
    session = make_session()
    league = make_league(session)
    monkeypatch.setattr(sleeper_league, "fetch_raw_league", lambda league_id: {})

    with pytest.raises(draft.DraftError):
        draft.create_draft_from_league(session, league.id, my_slot=1)


def test_create_draft_from_league_raises_on_league_fetch_failure(monkeypatch):
    session = make_session()
    league = make_league(session)

    def boom(league_id):
        raise sleeper_league.SleeperFetchError("no such league")

    monkeypatch.setattr(sleeper_league, "fetch_raw_league", boom)

    with pytest.raises(draft.DraftError):
        draft.create_draft_from_league(session, league.id, my_slot=1)


def test_create_draft_from_league_raises_on_draft_fetch_failure(monkeypatch):
    session = make_session()
    league = make_league(session)
    monkeypatch.setattr(sleeper_league, "fetch_raw_league", lambda league_id: {"draft_id": "555"})

    def boom(draft_id):
        raise sleeper_draft.SleeperFetchError("no such draft")

    monkeypatch.setattr(sleeper_draft, "fetch_raw_draft", boom)

    with pytest.raises(draft.DraftError):
        draft.create_draft_from_league(session, league.id, my_slot=1)


def test_create_draft_from_league_leaves_team_names_empty_pre_draft(monkeypatch):
    session = make_session()
    league = make_league(session, team_names={"10": "My Team"})
    monkeypatch.setattr(sleeper_league, "fetch_raw_league", lambda league_id: {"draft_id": "555"})
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        # no slot_to_roster_id -- draft order not yet randomized
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )

    created = draft.create_draft_from_league(session, league.id, my_slot=1)

    assert created.team_names is None


def test_sync_sleeper_draft_refreshes_team_names_once_available(monkeypatch):
    session = make_session()
    seed_players(session)
    league = make_league(session, team_names={"10": "My Team", "3": "Rival"})
    monkeypatch.setattr(sleeper_league, "fetch_raw_league", lambda league_id: {"draft_id": "555"})
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    created = draft.create_draft_from_league(session, league.id, my_slot=1)
    assert created.team_names is None

    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {
            "season": "2026",
            "settings": {"teams": 2, "rounds": 2},
            "slot_to_roster_id": {"1": 10, "2": 3},
        },
    )
    monkeypatch.setattr(sleeper_draft, "fetch_raw_picks", lambda draft_id: [])

    draft.sync_sleeper_draft(session, created.id)

    assert session.get(Draft, created.id).team_names == {"1": "My Team", "2": "Rival"}


def test_get_status_includes_rank_set_and_roster_positions_from_league(monkeypatch):
    session = make_session()
    league = make_league(session, roster_positions=["QB", "RB", "BN"], rank_set_id=42)
    monkeypatch.setattr(sleeper_league, "fetch_raw_league", lambda league_id: {"draft_id": "555"})
    monkeypatch.setattr(
        sleeper_draft,
        "fetch_raw_draft",
        lambda draft_id: {"season": "2026", "settings": {"teams": 2, "rounds": 2}},
    )
    created = draft.create_draft_from_league(session, league.id, my_slot=1)

    status = draft.get_status(session, created.id)

    assert status["draft"]["league_id"] == league.id
    assert status["draft"]["rank_set_id"] == 42
    assert status["draft"]["roster_positions"] == ["QB", "RB", "BN"]


def test_get_status_has_null_rank_set_and_roster_positions_for_non_league_draft():
    session = make_session()
    created = make_small_draft(session)

    status = draft.get_status(session, created.id)

    assert status["draft"]["league_id"] is None
    assert status["draft"]["rank_set_id"] is None
    assert status["draft"]["roster_positions"] is None
    assert status["draft"]["team_names"] == {}


def test_list_drafts_empty():
    session = make_session()

    assert draft.list_drafts(session) == []


def test_list_drafts_unfiltered_returns_all_newest_first():
    session = make_session()
    first = make_small_draft(session)
    second = make_small_draft(session)

    rows = draft.list_drafts(session)

    assert [row["id"] for row in rows] == [second.id, first.id]


def test_list_drafts_filters_by_league_id():
    session = make_session()
    league = make_league(session)
    make_small_draft(session)  # a manual draft with no league -- must be excluded
    league_draft = make_small_draft(session)
    league_draft.league_id = league.id
    session.commit()

    rows = draft.list_drafts(session, league_id=league.id)

    assert [row["id"] for row in rows] == [league_draft.id]


def test_list_drafts_reports_pick_count_and_round_progress():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session, num_teams=2, num_rounds=2)
    draft.make_pick(session, created.id, "1")
    draft.make_pick(session, created.id, "2")
    draft.make_pick(session, created.id, "3")

    rows = draft.list_drafts(session)

    row = rows[0]
    assert row["pick_count"] == 3
    assert row["next_pick_number"] == 4
    assert row["current_round"] == 2
    assert row["is_complete"] is False


def test_list_drafts_marks_a_full_draft_complete():
    session = make_session()
    seed_players(session)
    created = make_small_draft(session, num_teams=2, num_rounds=2)
    for player_id in ("1", "2", "3", "4"):
        draft.make_pick(session, created.id, player_id)

    row = draft.list_drafts(session)[0]

    assert row["pick_count"] == 4
    assert row["is_complete"] is True
    assert row["next_pick_number"] is None
    assert row["current_round"] is None
