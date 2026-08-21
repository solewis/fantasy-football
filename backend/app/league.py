from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.ingest import sleeper_league
from app.models import League

PLATFORM = "sleeper"


class LeagueError(ValueError):
    """A league action that can't be satisfied (bad Sleeper id, unknown league, ...)."""


def lookup_sleeper_league(platform_league_id: str) -> dict:
    """Preview a Sleeper league's settings without creating anything -- lets the
    setup form pre-fill name/team count/suggested format before you commit.
    """
    try:
        raw = sleeper_league.fetch_raw_league(platform_league_id)
        return sleeper_league.parse_league_meta(raw)
    except sleeper_league.SleeperFetchError as exc:
        raise LeagueError(str(exc)) from exc


def _fetch_league_and_team_names(platform_league_id: str) -> tuple[dict, dict[str, str]]:
    try:
        raw_league = sleeper_league.fetch_raw_league(platform_league_id)
        meta = sleeper_league.parse_league_meta(raw_league)
        raw_rosters = sleeper_league.fetch_raw_rosters(platform_league_id)
        raw_users = sleeper_league.fetch_raw_users(platform_league_id)
    except sleeper_league.SleeperFetchError as exc:
        raise LeagueError(str(exc)) from exc

    team_names = sleeper_league.parse_team_names(raw_rosters, raw_users)
    return meta, team_names


def create_league(
    session: Session,
    platform_league_id: str,
    format: str,
    rank_set_id: int | None = None,
) -> League:
    meta, team_names = _fetch_league_and_team_names(platform_league_id)

    league = League(
        platform=PLATFORM,
        platform_league_id=platform_league_id,
        name=meta["name"],
        season=meta["season"],
        format=format,
        num_teams=meta["num_teams"],
        roster_positions=meta["roster_positions"],
        team_names=team_names,
        rank_set_id=rank_set_id,
        created_at=datetime.now(UTC),
    )
    session.add(league)
    session.commit()
    session.refresh(league)
    return league


def get_league(session: Session, league_id: int) -> League | None:
    return session.get(League, league_id)


def list_leagues(session: Session, platform: str = PLATFORM) -> list[League]:
    return session.query(League).filter_by(platform=platform).order_by(League.id.asc()).all()


def sync_league(session: Session, league_id: int) -> League:
    """Re-fetch name/team count/roster shape/team names from Sleeper, in case
    the league's settings changed. Leaves format and rank_set_id untouched --
    those are your choices, not Sleeper's.
    """
    league = get_league(session, league_id)
    if league is None:
        raise LeagueError("League not found")

    meta, team_names = _fetch_league_and_team_names(league.platform_league_id)

    league.name = meta["name"]
    league.season = meta["season"]
    league.num_teams = meta["num_teams"]
    league.roster_positions = meta["roster_positions"]
    league.team_names = team_names
    session.commit()
    return league


def update_format(session: Session, league_id: int, format: str) -> League:
    league = get_league(session, league_id)
    if league is None:
        raise LeagueError("League not found")

    league.format = format
    session.commit()
    return league


def update_rank_set(session: Session, league_id: int, rank_set_id: int | None) -> League:
    league = get_league(session, league_id)
    if league is None:
        raise LeagueError("League not found")

    league.rank_set_id = rank_set_id
    session.commit()
    return league


def delete_league(session: Session, league_id: int) -> None:
    league = get_league(session, league_id)
    if league is None:
        raise LeagueError("League not found")

    session.delete(league)
    session.commit()
