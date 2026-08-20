import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import draft
from app.db import Base
from app.ingest import sleeper_draft
from app.models import DraftPick, DraftQueueEntry, PlatformPlayer


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
