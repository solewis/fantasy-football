from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.db import as_utc
from app.ingest import espn_players, sleeper, sleeper_adp
from app.league import list_leagues
from app.models import AdpEntry, PlatformPlayer, SyncStatus

PLATFORM = "sleeper"
PLAYERS_SYNC_TYPE = "sleeper_players"
ADP_SYNC_TYPE = "sleeper_adp"

# ESPN's player list and ADP come from one combined fetch (see
# app/ingest/espn_players.py), unlike Sleeper's two separate endpoints -- one
# sync type covers both.
ESPN_PLATFORM = "espn"
ESPN_PLAYERS_SYNC_TYPE = "espn_players"


class SyncError(ValueError):
    """A sync couldn't proceed (e.g. no ESPN league saved to sync through)."""


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


def sync_espn_players(session: Session, league_id: int | None = None) -> dict:
    """Sync ESPN's player list + ADP, using a saved ESPN League purely as the
    access point (the data itself isn't scoped to that one league -- see
    app/ingest/espn_players.py). Defaults to whichever ESPN league was saved
    first if none is specified, since the data is the same regardless of
    which one you pick.
    """
    if league_id is not None:
        league = next(
            (lg for lg in list_leagues(session, ESPN_PLATFORM) if lg.id == league_id), None
        )
    else:
        espn_leagues = list_leagues(session, ESPN_PLATFORM)
        league = espn_leagues[0] if espn_leagues else None

    if league is None:
        raise SyncError("No ESPN league saved yet -- add one from the Leagues tab first")

    result = espn_players.sync(session, league.platform_league_id, league.season)
    synced_at = _record_sync(session, ESPN_PLAYERS_SYNC_TYPE, league.season)
    return {
        "record_count": result["players_synced"],
        "adp_record_count": result["adp_synced"],
        "last_synced_at": synced_at,
    }


def get_status(session: Session, season: str) -> dict:
    players_status = (
        session.query(SyncStatus).filter_by(sync_type=PLAYERS_SYNC_TYPE, season=None).one_or_none()
    )
    adp_status = (
        session.query(SyncStatus).filter_by(sync_type=ADP_SYNC_TYPE, season=season).one_or_none()
    )
    espn_players_status = (
        session.query(SyncStatus)
        .filter_by(sync_type=ESPN_PLAYERS_SYNC_TYPE, season=season)
        .one_or_none()
    )

    players_count = session.query(PlatformPlayer).filter_by(platform=PLATFORM).count()
    adp_count = session.query(AdpEntry).filter_by(platform=PLATFORM, season=season).count()
    espn_players_count = session.query(PlatformPlayer).filter_by(platform=ESPN_PLATFORM).count()

    return {
        "players": {
            "last_synced_at": as_utc(players_status.last_synced_at if players_status else None),
            "record_count": players_count,
        },
        "adp": {
            "season": season,
            "last_synced_at": as_utc(adp_status.last_synced_at if adp_status else None),
            "record_count": adp_count,
        },
        "espn_players": {
            "last_synced_at": as_utc(
                espn_players_status.last_synced_at if espn_players_status else None
            ),
            "record_count": espn_players_count,
        },
    }
