import httpx

from app.config import ESPN_S2, ESPN_SWID
from app.ingest.errors import PlatformFetchError
from app.ingest.http import new_client

# ESPN's numeric league id is stable across seasons (unlike Sleeper/Yahoo,
# which each issue a new league id every year) -- the URL still needs a
# season, so a bare user-typed id can't identify a league-season on its own
# the way Sleeper's can. platform_league_id is stored/queried in the
# canonical "{season}:{league_id}" form; normalize_platform_league_id()
# below is the one place a bare id gets combined with a season.
DEFAULT_SEASON = "2026"

BASE_URL_TEMPLATE = (
    "https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl"
    "/seasons/{season}/segments/0/leagues/{league_id}"
)

# ESPN's CDN silently 302-redirects requests with no User-Agent (rather than
# erroring), and the "obvious" host (fantasy.espn.com) also just redirects --
# the correct host is lm-api-reads.fantasy.espn.com. Both were live footguns
# hit during development; don't "fix" this back to the obvious-looking one.
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# ESPN's numeric roster-slot ids -> this app's existing (Sleeper-derived)
# position vocabulary, so rosterSlots.ts/DraftRosterPanel.tsx need zero
# changes. Confirmed live against a real league. 20 (bench) and 21 (IR) are
# handled separately -- they're not "positions" for roster-shape purposes.
POSITION_SLOT_MAP = {
    0: "QB",
    2: "RB",
    4: "WR",
    6: "TE",
    16: "DEF",  # ESPN calls this D/ST; matches Sleeper's DEF naming
    17: "K",
    23: "FLEX",  # ESPN calls this RB/WR/TE
}
BENCH_SLOT_IDS = {20, 21}  # BE (bench), IR -- both fold into "BN"

# statId 53 = Receptions in ESPN's scoring-item list -- the same "points per
# reception" signal Sleeper's scoring_settings.rec is, confirmed live against
# a real half-PPR league (points: 0.5).
RECEPTION_STAT_ID = 53
SCORING_POINTS_TO_FORMAT = {0.0: "std", 0.5: "half_ppr", 1.0: "ppr"}


class ESPNFetchError(PlatformFetchError):
    """An ESPN league/team lookup failed or returned something unusable."""


def normalize_platform_league_id(platform_league_id: str) -> str:
    """Combine a bare user-typed ESPN league id with the current default
    season, unless it's already in the canonical "{season}:{league_id}" form
    (idempotent, since create_league() and sync_league() both end up calling
    this indirectly through the same dispatch path).
    """
    if ":" in platform_league_id:
        return platform_league_id
    return f"{DEFAULT_SEASON}:{platform_league_id}"


def split_league_id(platform_league_id: str) -> tuple[str, str]:
    season, _, league_id = platform_league_id.partition(":")
    if not league_id:
        raise ESPNFetchError(f"Malformed ESPN league id {platform_league_id!r}")
    return season, league_id


def cookies() -> dict[str, str] | None:
    if ESPN_S2 and ESPN_SWID:
        return {"espn_s2": ESPN_S2, "SWID": ESPN_SWID}
    return None


def fetch_raw_league(platform_league_id: str, client: httpx.Client | None = None) -> dict:
    season, league_id = split_league_id(platform_league_id)
    owns_client = client is None
    client = client or new_client()
    try:
        url = BASE_URL_TEMPLATE.format(season=season, league_id=league_id)
        try:
            response = client.get(
                url,
                params={"view": ["mSettings", "mTeam"]},
                headers={"User-Agent": USER_AGENT},
                cookies=cookies(),
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 401:
                raise ESPNFetchError(
                    "ESPN says this league isn't accessible with the current "
                    "credentials -- if it's a private league, re-extract "
                    "espn_s2/SWID from your browser and update backend/.env"
                ) from exc
            raise ESPNFetchError(f"No ESPN league found for id {platform_league_id!r}") from exc
        except httpx.RequestError as exc:
            raise ESPNFetchError(f"Could not reach ESPN: {exc}") from exc

        raw = response.json()
        if not isinstance(raw, dict):
            raise ESPNFetchError(f"No ESPN league found for id {platform_league_id!r}")
        return raw
    finally:
        if owns_client:
            client.close()


def parse_league_meta(raw: dict) -> dict:
    """Extract the settings we need to create a local League from ESPN's league object."""
    settings = raw.get("settings") or {}
    name = settings.get("name")
    season = raw.get("seasonId")
    num_teams = settings.get("size")

    slot_counts = ((settings.get("rosterSettings") or {}).get("lineupSlotCounts")) or {}
    roster_positions = []
    for slot_id_str, count in slot_counts.items():
        slot_id = int(slot_id_str)
        if slot_id in BENCH_SLOT_IDS:
            code = "BN"
        else:
            code = POSITION_SLOT_MAP.get(slot_id)
            if code is None:
                continue
        roster_positions.extend([code] * int(count))

    if not name or not season or not num_teams or not roster_positions:
        raise ESPNFetchError("ESPN league is missing name/season/team count/roster settings")

    suggested_format = None
    scoring_items = ((settings.get("scoringSettings") or {}).get("scoringItems")) or []
    for item in scoring_items:
        if item.get("statId") == RECEPTION_STAT_ID:
            suggested_format = SCORING_POINTS_TO_FORMAT.get(item.get("points"))
            break

    return {
        "name": name,
        "season": str(season),
        "num_teams": int(num_teams),
        "roster_positions": roster_positions,
        "suggested_format": suggested_format,
    }


def parse_team_names(raw: dict) -> dict[str, str]:
    """Map team id -> team name. Unlike Sleeper (which needs a separate
    rosters+users join with an owner-display-name fallback), ESPN's team
    objects always carry their own name directly -- confirmed live.
    """
    team_names: dict[str, str] = {}
    for team in raw.get("teams") or []:
        team_id = team.get("id")
        name = team.get("name")
        if team_id is None or not name:
            continue
        team_names[str(team_id)] = name
    return team_names


def fetch_and_parse_league(platform_league_id: str) -> tuple[dict, dict[str, str]]:
    """The uniform per-platform entry point app/league.py dispatches through.
    Unlike Sleeper (3 separate calls for league/rosters/users), ESPN gets
    everything needed from one call requesting both mSettings and mTeam.
    """
    raw = fetch_raw_league(platform_league_id)
    meta = parse_league_meta(raw)
    team_names = parse_team_names(raw)
    return meta, team_names
