from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import sync_service
from app.db import Base
from app.models import AdpEntry, PlatformPlayer, SyncStatus


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def fake_sleeper_sync(processed_count: int):
    """Mimics real ingestion semantics: returns the processed count on every
    call (whether rows are newly inserted or already present), so calling it
    repeatedly is safe -- same as the real upsert-based ingestion functions."""

    def _sync(session: Session) -> int:
        for i in range(processed_count):
            exists = (
                session.query(PlatformPlayer)
                .filter_by(platform="sleeper", platform_player_id=str(i))
                .one_or_none()
            )
            if not exists:
                session.add(
                    PlatformPlayer(
                        platform="sleeper",
                        platform_player_id=str(i),
                        name=f"Player {i}",
                        position="RB",
                        team="KC",
                    )
                )
        session.commit()
        return processed_count

    return _sync


def fake_sleeper_adp_sync(processed_count: int):
    def _sync(session: Session, season: str) -> int:
        for i in range(processed_count):
            exists = (
                session.query(AdpEntry)
                .filter_by(
                    platform="sleeper", platform_player_id=str(i), season=season, format="ppr"
                )
                .one_or_none()
            )
            if not exists:
                session.add(
                    AdpEntry(
                        platform="sleeper",
                        platform_player_id=str(i),
                        season=season,
                        format="ppr",
                        adp=float(i),
                    )
                )
        session.commit()
        return processed_count

    return _sync


def test_sync_players_records_status_and_returns_count(monkeypatch):
    session = make_session()
    monkeypatch.setattr(sync_service.sleeper, "sync", fake_sleeper_sync(5))

    result = sync_service.sync_players(session)

    assert result["record_count"] == 5
    assert result["last_synced_at"] is not None
    assert (
        session.query(SyncStatus).filter_by(sync_type="sleeper_players", season=None).count() == 1
    )


def test_sync_players_is_idempotent_on_status_row(monkeypatch):
    session = make_session()
    monkeypatch.setattr(sync_service.sleeper, "sync", fake_sleeper_sync(5))

    first = sync_service.sync_players(session)
    second = sync_service.sync_players(session)

    assert second["last_synced_at"] >= first["last_synced_at"]
    assert (
        session.query(SyncStatus).filter_by(sync_type="sleeper_players", season=None).count() == 1
    )


def test_sync_adp_records_status_scoped_to_season(monkeypatch):
    session = make_session()
    monkeypatch.setattr(sync_service.sleeper_adp, "sync", fake_sleeper_adp_sync(3))

    result = sync_service.sync_adp(session, "2026")

    assert result == {
        "season": "2026",
        "record_count": 3,
        "last_synced_at": result["last_synced_at"],
    }
    assert session.query(SyncStatus).filter_by(sync_type="sleeper_adp", season="2026").count() == 1
    assert session.query(SyncStatus).filter_by(sync_type="sleeper_adp", season="2025").count() == 0


def test_get_status_reports_never_synced_when_nothing_has_run():
    session = make_session()

    status = sync_service.get_status(session, "2026")

    assert status["players"] == {"last_synced_at": None, "record_count": 0}
    assert status["adp"] == {"season": "2026", "last_synced_at": None, "record_count": 0}


def test_get_status_reflects_live_counts_and_recorded_timestamps(monkeypatch):
    session = make_session()
    monkeypatch.setattr(sync_service.sleeper, "sync", fake_sleeper_sync(7))
    monkeypatch.setattr(sync_service.sleeper_adp, "sync", fake_sleeper_adp_sync(4))
    sync_service.sync_players(session)
    sync_service.sync_adp(session, "2026")

    status = sync_service.get_status(session, "2026")

    assert status["players"]["record_count"] == 7
    assert status["players"]["last_synced_at"] is not None
    assert status["adp"]["record_count"] == 4
    assert status["adp"]["last_synced_at"] is not None


def test_get_status_does_not_leak_adp_status_across_seasons(monkeypatch):
    session = make_session()
    monkeypatch.setattr(sync_service.sleeper_adp, "sync", fake_sleeper_adp_sync(4))
    sync_service.sync_adp(session, "2026")

    status = sync_service.get_status(session, "2025")

    assert status["adp"] == {"season": "2025", "last_synced_at": None, "record_count": 0}
