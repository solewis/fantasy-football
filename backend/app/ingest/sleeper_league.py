import httpx

from app.ingest.errors import PlatformFetchError
from app.ingest.http import new_client

LEAGUE_URL_TEMPLATE = "https://api.sleeper.app/v1/league/{league_id}"
ROSTERS_URL_TEMPLATE = "https://api.sleeper.app/v1/league/{league_id}/rosters"
USERS_URL_TEMPLATE = "https://api.sleeper.app/v1/league/{league_id}/users"

# Sleeper's league object doesn't expose a scoring "format" label directly (that
# only lives on a *draft's* metadata.scoring_type, which is a different object)
# -- but scoring_settings.rec (points per reception) is always present and maps
# cleanly onto our std/half_ppr/ppr buckets. Anything else (e.g. a non-standard
# rec value) gets no suggestion; the format field is always left user-editable.
SCORING_REC_TO_FORMAT = {0.0: "std", 0.5: "half_ppr", 1.0: "ppr"}


class SleeperFetchError(PlatformFetchError):
    """A Sleeper league/rosters/users lookup failed or returned something unusable."""


def _get_json(url: str, client: httpx.Client | None, not_found_msg: str) -> object:
    owns_client = client is None
    client = client or new_client()
    try:
        try:
            response = client.get(url)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise SleeperFetchError(not_found_msg) from exc
        except httpx.RequestError as exc:
            raise SleeperFetchError(f"Could not reach Sleeper: {exc}") from exc
        return response.json()
    finally:
        if owns_client:
            client.close()


def fetch_raw_league(league_id: str, client: httpx.Client | None = None) -> dict:
    raw = _get_json(
        LEAGUE_URL_TEMPLATE.format(league_id=league_id),
        client,
        f"No Sleeper league found for id {league_id!r}",
    )
    if not isinstance(raw, dict):
        raise SleeperFetchError(f"No Sleeper league found for id {league_id!r}")
    return raw


def fetch_raw_rosters(league_id: str, client: httpx.Client | None = None) -> list[dict]:
    raw = _get_json(
        ROSTERS_URL_TEMPLATE.format(league_id=league_id),
        client,
        f"No Sleeper rosters found for league id {league_id!r}",
    )
    if not isinstance(raw, list):
        raise SleeperFetchError(f"No Sleeper rosters found for league id {league_id!r}")
    return raw


def fetch_raw_users(league_id: str, client: httpx.Client | None = None) -> list[dict]:
    raw = _get_json(
        USERS_URL_TEMPLATE.format(league_id=league_id),
        client,
        f"No Sleeper users found for league id {league_id!r}",
    )
    if not isinstance(raw, list):
        raise SleeperFetchError(f"No Sleeper users found for league id {league_id!r}")
    return raw


def parse_league_meta(raw: dict) -> dict:
    """Extract the settings we need to create a local League from Sleeper's league object."""
    name = raw.get("name")
    season = raw.get("season")
    num_teams = raw.get("total_rosters") or (raw.get("settings") or {}).get("num_teams")
    roster_positions = raw.get("roster_positions")

    if not name or not season or not num_teams or not roster_positions:
        raise SleeperFetchError("Sleeper league is missing name/season/team count/roster settings")

    rec = (raw.get("scoring_settings") or {}).get("rec")
    suggested_format = SCORING_REC_TO_FORMAT.get(rec)

    return {
        "name": name,
        "season": str(season),
        "num_teams": int(num_teams),
        "roster_positions": list(roster_positions),
        "suggested_format": suggested_format,
    }


def parse_team_names(raw_rosters: list[dict], raw_users: list[dict]) -> dict[str, str]:
    """Map roster_id -> team name, joining rosters (roster_id/owner_id) against
    users (user_id/display_name/metadata.team_name). Falls back to the owner's
    display name if they haven't set a custom team name, and to a generic label
    if the roster has no owner at all (e.g. an orphaned/unclaimed slot).
    """
    name_by_user_id: dict[str, str] = {}
    for user in raw_users:
        user_id = user.get("user_id")
        if not user_id:
            continue
        team_name = (user.get("metadata") or {}).get("team_name") or user.get("display_name")
        if team_name:
            name_by_user_id[user_id] = team_name

    team_names: dict[str, str] = {}
    for roster in raw_rosters:
        roster_id = roster.get("roster_id")
        if roster_id is None:
            continue
        owner_id = roster.get("owner_id")
        team_names[str(roster_id)] = name_by_user_id.get(owner_id, f"Team {roster_id}")
    return team_names


def fetch_and_parse_league(platform_league_id: str) -> tuple[dict, dict[str, str]]:
    """The uniform per-platform entry point app/league.py dispatches through --
    fetch everything needed to create/sync a local League and return
    (meta, team_names). Sleeper needs three separate calls (league, rosters,
    users) to build this; other platforms may need only one, but this
    function is the seam that hides that difference from the service layer.
    """
    raw_league = fetch_raw_league(platform_league_id)
    meta = parse_league_meta(raw_league)
    raw_rosters = fetch_raw_rosters(platform_league_id)
    raw_users = fetch_raw_users(platform_league_id)
    team_names = parse_team_names(raw_rosters, raw_users)
    return meta, team_names
