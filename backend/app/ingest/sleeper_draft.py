import ssl

import httpx
import truststore

DRAFT_URL_TEMPLATE = "https://api.sleeper.app/v1/draft/{draft_id}"
DRAFT_PICKS_URL_TEMPLATE = "https://api.sleeper.app/v1/draft/{draft_id}/picks"


class SleeperFetchError(Exception):
    """A Sleeper draft/picks lookup failed or returned something unusable."""


def _new_client() -> httpx.Client:
    # See app/ingest/sleeper.py::_new_client for why this isn't httpx's default verify.
    ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    return httpx.Client(timeout=30, verify=ctx)


def fetch_raw_draft(draft_id: str, client: httpx.Client | None = None) -> dict:
    owns_client = client is None
    client = client or _new_client()
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
    client = client or _new_client()
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
        # draft-slot (str) -> roster_id (int). Sleeper only assigns this once the
        # draft's order is set -- can be {} pre-draft, that's not an error here.
        "slot_to_roster_id": raw.get("slot_to_roster_id") or {},
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
