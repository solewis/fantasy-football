import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import league
from app.db import Base
from app.ingest import sleeper_league
from app.models import League


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def stub_sleeper(monkeypatch, meta=None, team_names=None):
    default_meta = {
        "name": "Sunday Funday",
        "season": "2026",
        "num_teams": 10,
        "roster_positions": ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "K", "DEF"],
        "suggested_format": "half_ppr",
    }
    monkeypatch.setattr(sleeper_league, "fetch_raw_league", lambda league_id: {"stub": True})
    monkeypatch.setattr(sleeper_league, "parse_league_meta", lambda raw: meta or default_meta)
    monkeypatch.setattr(sleeper_league, "fetch_raw_rosters", lambda league_id: [])
    monkeypatch.setattr(sleeper_league, "fetch_raw_users", lambda league_id: [])
    monkeypatch.setattr(
        sleeper_league,
        "parse_team_names",
        lambda rosters, users: team_names if team_names is not None else {"1": "Team 1"},
    )


def test_lookup_sleeper_league_returns_preview(monkeypatch):
    stub_sleeper(monkeypatch)

    meta = league.lookup_sleeper_league("999")

    assert meta["name"] == "Sunday Funday"
    assert meta["suggested_format"] == "half_ppr"


def test_lookup_sleeper_league_raises_on_fetch_failure(monkeypatch):
    def boom(league_id):
        raise sleeper_league.SleeperFetchError("no such league")

    monkeypatch.setattr(sleeper_league, "fetch_raw_league", boom)

    with pytest.raises(league.LeagueError):
        league.lookup_sleeper_league("bad-id")


def test_create_league_persists_settings_and_team_names(monkeypatch):
    session = make_session()
    stub_sleeper(monkeypatch, team_names={"1": "Bourrow my Toe"})

    created = league.create_league(session, "999", format="half_ppr", rank_set_id=None)

    assert created.platform == "sleeper"
    assert created.platform_league_id == "999"
    assert created.name == "Sunday Funday"
    assert created.season == "2026"
    assert created.num_teams == 10
    assert created.roster_positions == [
        "QB",
        "RB",
        "RB",
        "WR",
        "WR",
        "TE",
        "FLEX",
        "K",
        "DEF",
    ]
    assert created.team_names == {"1": "Bourrow my Toe"}
    assert created.rank_set_id is None


def test_create_league_raises_on_fetch_failure(monkeypatch):
    session = make_session()

    def boom(league_id):
        raise sleeper_league.SleeperFetchError("no such league")

    monkeypatch.setattr(sleeper_league, "fetch_raw_league", boom)

    with pytest.raises(league.LeagueError):
        league.create_league(session, "bad-id", format="half_ppr")


def test_sync_league_updates_settings_but_not_format_or_rank_set(monkeypatch):
    session = make_session()
    stub_sleeper(monkeypatch)
    created = league.create_league(session, "999", format="half_ppr", rank_set_id=None)

    stub_sleeper(
        monkeypatch,
        meta={
            "name": "Renamed League",
            "season": "2026",
            "num_teams": 12,
            "roster_positions": ["QB"],
            "suggested_format": "ppr",
        },
        team_names={"1": "New Team Name"},
    )

    synced = league.sync_league(session, created.id)

    assert synced.name == "Renamed League"
    assert synced.num_teams == 12
    assert synced.roster_positions == ["QB"]
    assert synced.team_names == {"1": "New Team Name"}
    assert synced.format == "half_ppr"  # untouched -- Sleeper doesn't own this


def test_sync_unknown_league_raises():
    session = make_session()

    with pytest.raises(league.LeagueError):
        league.sync_league(session, 999)


def test_update_format(monkeypatch):
    session = make_session()
    stub_sleeper(monkeypatch)
    created = league.create_league(session, "999", format="half_ppr")

    updated = league.update_format(session, created.id, "ppr")

    assert updated.format == "ppr"


def test_update_rank_set_can_set_and_clear(monkeypatch):
    session = make_session()
    stub_sleeper(monkeypatch)
    created = league.create_league(session, "999", format="half_ppr")

    league.update_rank_set(session, created.id, 42)
    assert session.get(League, created.id).rank_set_id == 42

    league.update_rank_set(session, created.id, None)
    assert session.get(League, created.id).rank_set_id is None


def test_delete_league_removes_it(monkeypatch):
    session = make_session()
    stub_sleeper(monkeypatch)
    created = league.create_league(session, "999", format="half_ppr")

    league.delete_league(session, created.id)

    assert session.get(League, created.id) is None


def test_delete_unknown_league_raises():
    session = make_session()

    with pytest.raises(league.LeagueError):
        league.delete_league(session, 999)


def test_list_leagues_ordered_by_creation(monkeypatch):
    session = make_session()
    stub_sleeper(monkeypatch)
    first = league.create_league(session, "111", format="half_ppr")
    second = league.create_league(session, "222", format="ppr")

    rows = league.list_leagues(session)

    assert [row.id for row in rows] == [first.id, second.id]
