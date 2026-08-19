import ssl

import httpx
import truststore
from sqlalchemy.orm import Session

from app.models import AdpEntry

PROJECTIONS_URL_TEMPLATE = "https://api.sleeper.com/projections/nfl/{season}"
DEFAULT_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF"]
PLATFORM = "sleeper"

# Sleeper uses 999(.0) as a sentinel for "no ADP in this format" (e.g. adp_rookie
# on a veteran, or the unused plain adp_dynasty field) rather than omitting the
# key entirely. Anything at or above this is treated as no data, not a real ADP.
UNRANKED_SENTINEL = 999.0


def _new_client() -> httpx.Client:
    # See app/ingest/sleeper.py::_new_client for why this isn't httpx's default verify.
    ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    return httpx.Client(timeout=30, verify=ctx)


def fetch_raw_projections(
    season: str,
    positions: list[str] = DEFAULT_POSITIONS,
    season_type: str = "regular",
    client: httpx.Client | None = None,
) -> list[dict]:
    owns_client = client is None
    client = client or _new_client()
    try:
        params = [("season_type", season_type), ("order_by", "pts_ppr")]
        params += [("position[]", position) for position in positions]
        response = client.get(PROJECTIONS_URL_TEMPLATE.format(season=season), params=params)
        response.raise_for_status()
        return response.json()
    finally:
        if owns_client:
            client.close()


def parse_adp_entries(raw: list[dict], season: str) -> list[dict]:
    """Flatten Sleeper's projection rows into one AdpEntry row per (player, format).

    Each row carries several `adp_<format>` stats (std, ppr, half_ppr, 2qb,
    dynasty variants, idp variants, rookie). Rows at/above UNRANKED_SENTINEL
    are dropped rather than stored as a real ADP.
    """
    records = []
    for row in raw:
        player_id = row.get("player_id")
        stats = row.get("stats") or {}
        if not player_id:
            continue

        for key, value in stats.items():
            if not key.startswith("adp_") or value is None:
                continue
            if value >= UNRANKED_SENTINEL:
                continue

            records.append(
                {
                    "platform": PLATFORM,
                    "platform_player_id": player_id,
                    "season": season,
                    "format": key.removeprefix("adp_"),
                    "adp": value,
                }
            )
    return records


def upsert_adp_entries(session: Session, records: list[dict]) -> int:
    count = 0
    for record in records:
        existing = (
            session.query(AdpEntry)
            .filter_by(
                platform=record["platform"],
                platform_player_id=record["platform_player_id"],
                season=record["season"],
                format=record["format"],
            )
            .one_or_none()
        )
        if existing:
            existing.adp = record["adp"]
        else:
            session.add(AdpEntry(**record))
        count += 1
    session.commit()
    return count


def sync(session: Session, season: str) -> int:
    raw = fetch_raw_projections(season)
    records = parse_adp_entries(raw, season)
    return upsert_adp_entries(session, records)
