import ssl

import httpx
import truststore
from sqlalchemy.orm import Session

from app.models import PlatformPlayer

SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl"
PLATFORM = "sleeper"


def _new_client() -> httpx.Client:
    # httpx defaults to its bundled certifi CA store, which can lag behind
    # newer intermediate CAs (and won't include a corporate TLS-inspection
    # root either). truststore delegates verification to the OS's native
    # trust store instead, same as curl, so it stays correct without pinning
    # a static CA bundle file.
    ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    return httpx.Client(timeout=30, verify=ctx)


def fetch_raw_players(client: httpx.Client | None = None) -> dict:
    owns_client = client is None
    client = client or _new_client()
    try:
        response = client.get(SLEEPER_PLAYERS_URL)
        response.raise_for_status()
        return response.json()
    finally:
        if owns_client:
            client.close()


def parse_players(raw: dict) -> list[dict]:
    """Normalize Sleeper's raw player map into platform_players rows.

    Handles the shapes that trip up naive parsing: DST entries have no
    full_name (only first_name/last_name), free agents may have no team,
    and some entries are just `null`.
    """
    records = []
    for player_id, data in raw.items():
        if not data:
            continue

        full_name = data.get("full_name") or " ".join(
            part for part in [data.get("first_name"), data.get("last_name")] if part
        )
        if not full_name:
            continue

        records.append(
            {
                "platform": PLATFORM,
                "platform_player_id": player_id,
                "name": full_name,
                "position": data.get("position"),
                "team": data.get("team"),
            }
        )
    return records


def upsert_players(session: Session, records: list[dict]) -> int:
    count = 0
    for record in records:
        existing = (
            session.query(PlatformPlayer)
            .filter_by(platform=record["platform"], platform_player_id=record["platform_player_id"])
            .one_or_none()
        )
        if existing:
            existing.name = record["name"]
            existing.position = record["position"]
            existing.team = record["team"]
        else:
            session.add(PlatformPlayer(**record))
        count += 1
    session.commit()
    return count


def sync(session: Session) -> int:
    raw = fetch_raw_players()
    records = parse_players(raw)
    return upsert_players(session, records)
