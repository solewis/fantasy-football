from datetime import UTC, datetime

from sqlalchemy.orm import Session

from app.ingest import platforms
from app.ingest.errors import PlatformFetchError
from app.models import Draft, DraftPick, DraftQueueEntry, League, RankSet
from app.ranks import OVERALL


class LeagueError(ValueError):
    """A league action that can't be satisfied (bad platform id, unknown league, ...)."""


def lookup_league(platform: str, platform_league_id: str) -> dict:
    """Preview a league's settings without creating anything -- lets the
    setup form pre-fill name/team count/suggested format before you commit.
    """
    try:
        module = platforms.league_ingest(platform)
        normalized_id = module.normalize_platform_league_id(platform_league_id)
        raw = module.fetch_raw_league(normalized_id)
        return module.parse_league_meta(raw)
    except PlatformFetchError as exc:
        raise LeagueError(str(exc)) from exc


def _fetch_league_and_team_names(
    platform: str, platform_league_id: str
) -> tuple[dict, dict[str, str]]:
    """platform_league_id here must already be normalized (the canonical form
    stored on League and reused as-is by sync_league) -- normalization only
    happens once, at create_league()/lookup_league() time.
    """
    try:
        module = platforms.league_ingest(platform)
        return module.fetch_and_parse_league(platform_league_id)
    except PlatformFetchError as exc:
        raise LeagueError(str(exc)) from exc


def create_league(
    session: Session,
    platform: str,
    platform_league_id: str,
    format: str,
    rank_set_id: int | None = None,
) -> League:
    try:
        normalized_id = platforms.league_ingest(platform).normalize_platform_league_id(
            platform_league_id
        )
    except PlatformFetchError as exc:
        raise LeagueError(str(exc)) from exc
    meta, team_names = _fetch_league_and_team_names(platform, normalized_id)

    league = League(
        platform=platform,
        platform_league_id=normalized_id,
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


def list_leagues(session: Session, platform: str | None = None) -> list[League]:
    query = session.query(League)
    if platform is not None:
        query = query.filter_by(platform=platform)
    return query.order_by(League.id.asc()).all()


def sync_league(session: Session, league_id: int) -> League:
    """Re-fetch name/team count/roster shape/team names from the league's own
    platform, in case its settings changed. Leaves format and rank_set_id
    untouched -- those are your choices, not the platform's.
    """
    league = get_league(session, league_id)
    if league is None:
        raise LeagueError("League not found")

    meta, team_names = _fetch_league_and_team_names(league.platform, league.platform_league_id)

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

    if rank_set_id is not None:
        rank_set = session.get(RankSet, rank_set_id)
        if rank_set is None:
            raise LeagueError("Rank set not found")
        if rank_set.platform != league.platform:
            raise LeagueError(
                f"Can't assign a {rank_set.platform} rank set to a {league.platform} league"
            )
        # A league drafts every position, so it needs a whole-board list. A
        # positional set is an ingredient for building one, not a substitute.
        if rank_set.scope != OVERALL:
            raise LeagueError(f"A league needs an overall rank set, not a {rank_set.scope} list")

    league.rank_set_id = rank_set_id
    session.commit()
    return league


def delete_league(session: Session, league_id: int) -> None:
    league = get_league(session, league_id)
    if league is None:
        raise LeagueError("League not found")

    # No PRAGMA foreign_keys=ON in this app -- unlike RankSet (which a League
    # only *references* and can outlive), a Draft created from a League is an
    # owned child: get_status() derives its rank_set_id/roster_positions live
    # from Draft.league, so an orphaned draft would just break. Cascade the
    # delete explicitly rather than leaving it dangling.
    draft_ids = [row[0] for row in session.query(Draft.id).filter_by(league_id=league_id).all()]
    if draft_ids:
        session.query(DraftPick).filter(DraftPick.draft_id.in_(draft_ids)).delete(
            synchronize_session=False
        )
        session.query(DraftQueueEntry).filter(DraftQueueEntry.draft_id.in_(draft_ids)).delete(
            synchronize_session=False
        )
        session.query(Draft).filter(Draft.id.in_(draft_ids)).delete(synchronize_session=False)

    session.delete(league)
    session.commit()
