from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.ingest import sleeper, sleeper_adp
from app.models import AdpEntry, PlatformPlayer, SyncStatus

PLATFORM = "sleeper"
PLAYERS_SYNC_TYPE = "sleeper_players"
ADP_SYNC_TYPE = "sleeper_adp"


def _record_sync(session: Session, sync_type: str, season: str | None) -> datetime:
    now = datetime.now(UTC)
    existing = session.query(SyncStatus).filter_by(sync_type=sync_type, season=season).one_or_none()
    if existing:
        existing.last_synced_at = now
    else:
        session.add(SyncStatus(sync_type=sync_type, season=season, last_synced_at=now))
    session.commit()
    return now


def sync_players(session: Session) -> dict:
    count = sleeper.sync(session)
    synced_at = _record_sync(session, PLAYERS_SYNC_TYPE, None)
    return {"record_count": count, "last_synced_at": synced_at}


def sync_adp(session: Session, season: str) -> dict:
    count = sleeper_adp.sync(session, season)
    synced_at = _record_sync(session, ADP_SYNC_TYPE, season)
    return {"season": season, "record_count": count, "last_synced_at": synced_at}


def get_status(session: Session, season: str) -> dict:
    players_status = (
        session.query(SyncStatus).filter_by(sync_type=PLAYERS_SYNC_TYPE, season=None).one_or_none()
    )
    adp_status = (
        session.query(SyncStatus).filter_by(sync_type=ADP_SYNC_TYPE, season=season).one_or_none()
    )

    players_count = session.query(PlatformPlayer).filter_by(platform=PLATFORM).count()
    adp_count = session.query(AdpEntry).filter_by(platform=PLATFORM, season=season).count()

    return {
        "players": {
            "last_synced_at": players_status.last_synced_at if players_status else None,
            "record_count": players_count,
        },
        "adp": {
            "season": season,
            "last_synced_at": adp_status.last_synced_at if adp_status else None,
            "record_count": adp_count,
        },
    }
