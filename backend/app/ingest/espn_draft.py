import httpx

from app.ingest.errors import PlatformFetchError
from app.ingest.espn_league import BASE_URL_TEMPLATE, USER_AGENT, cookies, split_league_id
from app.ingest.http import new_client

# This app's draft board is pure snake-order math (app/draft_logic.py) -- an
# auction league has no such thing as a fixed pick/team order, so it's
# rejected outright rather than producing a nonsensical board.
SUPPORTED_DRAFT_TYPE = "SNAKE"


class ESPNDraftFetchError(PlatformFetchError):
    """An ESPN draft lookup failed, returned something unusable, or isn't a
    snake draft."""


def resolve_platform_draft_id(platform_league_id: str) -> str:
    """ESPN has no separate draft object/id -- the draft is embedded in the
    league itself, so the league's own id doubles as the draft id (unlike
    Sleeper, whose draft is a separate object discovered via the league's
    draft_id field; see sleeper_draft.resolve_platform_draft_id).
    """
    return platform_league_id


def fetch_raw_draft(platform_draft_id: str, client: httpx.Client | None = None) -> dict:
    """Fetches the same per-league payload as espn_league.fetch_raw_league,
    plus mDraftDetail -- ESPN has no dedicated draft-only endpoint the way
    Sleeper does.
    """
    season, league_id = split_league_id(platform_draft_id)
    owns_client = client is None
    client = client or new_client()
    try:
        url = BASE_URL_TEMPLATE.format(season=season, league_id=league_id)
        try:
            response = client.get(
                url,
                params={"view": ["mDraftDetail", "mSettings", "mTeam"]},
                headers={"User-Agent": USER_AGENT},
                cookies=cookies(),
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ESPNDraftFetchError(f"Could not fetch ESPN draft: {exc}") from exc
        except httpx.RequestError as exc:
            raise ESPNDraftFetchError(f"Could not reach ESPN: {exc}") from exc

        raw = response.json()
        if not isinstance(raw, dict):
            raise ESPNDraftFetchError("ESPN draft response was not the expected shape")
        return raw
    finally:
        if owns_client:
            client.close()


def fetch_raw_picks(platform_draft_id: str, client: httpx.Client | None = None) -> dict:
    """ESPN has no separate picks endpoint -- picks live inside the same
    per-league payload as the draft's own metadata (draftDetail.picks), so
    this just re-fetches it. One redundant request per sync tick versus
    Sleeper's dedicated picks endpoint, traded for a fetch_raw_draft/
    fetch_raw_picks contract both ingest modules can be dispatched through
    identically.
    """
    return fetch_raw_draft(platform_draft_id, client=client)


def parse_draft_meta(raw: dict) -> dict:
    """Extract the settings needed to create/refresh a local Draft from
    ESPN's league+draftDetail payload.

    Unlike Sleeper (whose slot_to_roster_id only appears once the draft's
    order is randomized, and whose num_rounds/num_teams need cross-checking
    against roster-slot totals pre-draft), ESPN publishes the full
    authoritative pick/team order upfront regardless of draft progress --
    slot_to_team_id below is read straight from round 1's picks and confirmed
    live to reverse correctly in round 2 (a real snake draft), not assumed.
    """
    draft_type = ((raw.get("settings") or {}).get("draftSettings") or {}).get("type")
    if draft_type and draft_type != SUPPORTED_DRAFT_TYPE:
        raise ESPNDraftFetchError(
            f"Only snake drafts are supported -- this league is set to {draft_type!r}"
        )

    picks = (raw.get("draftDetail") or {}).get("picks") or []
    if not picks:
        raise ESPNDraftFetchError("ESPN league has no draft picks configured")

    season = raw.get("seasonId")
    if not season:
        raise ESPNDraftFetchError("ESPN draft response is missing seasonId")

    num_rounds = max(pick["roundId"] for pick in picks)
    slot_to_team_id = {
        str(pick["roundPickNumber"]): pick["teamId"] for pick in picks if pick["roundId"] == 1
    }

    return {
        "season": str(season),
        "num_teams": len(slot_to_team_id),
        "num_rounds": num_rounds,
        "slot_to_team_id": slot_to_team_id,
    }


def parse_picks(raw: dict) -> list[dict]:
    """Normalize ESPN's picks list into (pick_number, platform_player_id)
    pairs. ESPN pre-populates every pick slot with playerId: -1 before it's
    made -- unlike Sleeper's picks endpoint, which simply omits unmade picks
    -- so -1 has to be filtered out explicitly here.
    """
    picks = (raw.get("draftDetail") or {}).get("picks") or []
    records = []
    for pick in picks:
        player_id = pick.get("playerId")
        pick_no = pick.get("overallPickNumber")
        if player_id is None or player_id == -1 or not pick_no:
            continue
        records.append({"pick_number": int(pick_no), "platform_player_id": str(player_id)})
    return records
