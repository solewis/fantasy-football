import httpx

from app.ingest import sleeper_league
from app.ingest.errors import PlatformFetchError
from app.ingest.http import new_client

DRAFT_URL_TEMPLATE = "https://api.sleeper.app/v1/draft/{draft_id}"
DRAFT_PICKS_URL_TEMPLATE = "https://api.sleeper.app/v1/draft/{draft_id}/picks"


class SleeperFetchError(PlatformFetchError):
    """A Sleeper draft/picks lookup failed or returned something unusable."""


def resolve_platform_draft_id(platform_league_id: str) -> str:
    """Sleeper's draft is a separate object with its own id, discoverable only
    via the league's own draft_id field -- unlike ESPN, where the draft is
    embedded in the league itself and needs no separate resolution (see
    espn_draft.py's identity implementation of this same function).
    """
    try:
        raw_league = sleeper_league.fetch_raw_league(platform_league_id)
    except sleeper_league.SleeperFetchError as exc:
        raise SleeperFetchError(str(exc)) from exc

    platform_draft_id = raw_league.get("draft_id")
    if not platform_draft_id:
        raise SleeperFetchError("This league doesn't have an active draft yet")
    return platform_draft_id


def fetch_raw_draft(draft_id: str, client: httpx.Client | None = None) -> dict:
    owns_client = client is None
    client = client or new_client()
    try:
        try:
            response = client.get(DRAFT_URL_TEMPLATE.format(draft_id=draft_id))
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise SleeperFetchError(f"No Sleeper draft found for id {draft_id!r}") from exc
        except httpx.RequestError as exc:
            raise SleeperFetchError(f"Could not reach Sleeper: {exc}") from exc

        raw = response.json()
        # Sleeper can also return a 200 with a `null` body in some cases --
        # that has to be treated as an error explicitly too.
        if not isinstance(raw, dict):
            raise SleeperFetchError(f"No Sleeper draft found for id {draft_id!r}")
        return raw
    finally:
        if owns_client:
            client.close()


def fetch_raw_picks(draft_id: str, client: httpx.Client | None = None) -> list[dict]:
    owns_client = client is None
    client = client or new_client()
    try:
        try:
            response = client.get(DRAFT_PICKS_URL_TEMPLATE.format(draft_id=draft_id))
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise SleeperFetchError(f"No Sleeper picks found for draft id {draft_id!r}") from exc
        except httpx.RequestError as exc:
            raise SleeperFetchError(f"Could not reach Sleeper: {exc}") from exc

        raw = response.json()
        if not isinstance(raw, list):
            raise SleeperFetchError(f"No Sleeper picks found for draft id {draft_id!r}")
        return raw
    finally:
        if owns_client:
            client.close()


def parse_draft_meta(raw: dict) -> dict:
    """Extract the settings we need to create a local Draft from Sleeper's draft object."""
    settings = raw.get("settings") or {}
    season = raw.get("season")
    num_teams = settings.get("teams")
    num_rounds = settings.get("rounds")

    if not season or not num_teams or not num_rounds:
        raise SleeperFetchError("Sleeper draft is missing season/teams/rounds settings")

    return {
        "season": str(season),
        "num_teams": int(num_teams),
        "num_rounds": int(num_rounds),
        # draft-slot (str) -> team id (int; Sleeper calls this a roster_id).
        # Sleeper only assigns this once the draft's order is set -- can be {}
        # pre-draft, that's not an error here.
        "slot_to_team_id": raw.get("slot_to_roster_id") or {},
    }


def parse_picks(raw: list[dict]) -> list[dict]:
    """Normalize Sleeper's picks list into (pick_number, platform_player_id) pairs.

    Skips entries without a player_id -- Sleeper's picks endpoint only returns
    picks that have actually been made, but this guards defensively anyway.
    """
    records = []
    for pick in raw:
        player_id = pick.get("player_id")
        pick_no = pick.get("pick_no")
        if not player_id or not pick_no:
            continue
        records.append({"pick_number": int(pick_no), "platform_player_id": player_id})
    return records
