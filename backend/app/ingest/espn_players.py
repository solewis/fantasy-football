import json

import httpx
from sqlalchemy.orm import Session

from app.ingest.espn_league import (
    BASE_URL_TEMPLATE,
    USER_AGENT,
    ESPNFetchError,
    cookies,
    split_league_id,
)
from app.ingest.http import new_client
from app.models import AdpEntry, PlatformPlayer

PLATFORM = "espn"

# Confirmed live: ESPN's kona_player_info view returns its entire rosterable
# player pool (~1000 players) in a single request when given a generous
# limit -- both 2000 and 5000 returned the same 1027 players, so this is a
# one-shot fetch, not a paginated sweep the way Sleeper/Yahoo's player lists
# need to be.
FETCH_LIMIT = 2000

# A player's own position (player.defaultPositionId) uses a different ESPN
# vocabulary from a roster's lineupSlotCounts slot IDs (espn_league's
# POSITION_SLOT_MAP) -- RB=2 and DEF=16 happen to coincide between the two,
# which is exactly what let this diverge unnoticed until live verification
# caught every WR/QB/TE/K coming back with position: null. Confirmed live.
PLAYER_POSITION_MAP = {1: "QB", 2: "RB", 3: "WR", 4: "TE", 5: "K", 16: "DEF"}

PRO_TEAM_MAP = {
    0: None,
    1: "ATL",
    2: "BUF",
    3: "CHI",
    4: "CIN",
    5: "CLE",
    6: "DAL",
    7: "DEN",
    8: "DET",
    9: "GB",
    10: "TEN",
    11: "IND",
    12: "KC",
    13: "LV",
    14: "LAR",
    15: "MIA",
    16: "MIN",
    17: "NE",
    18: "NO",
    19: "NYG",
    20: "NYJ",
    21: "PHI",
    22: "ARI",
    23: "PIT",
    24: "LAC",
    25: "SF",
    26: "SEA",
    27: "TB",
    28: "WSH",
    29: "CAR",
    30: "JAX",
    33: "BAL",
    34: "HOU",
}

# ESPN's draftRanksByRankType only ever has these buckets -- there is no
# HALF_PPR bucket at all (confirmed live across an entire player pool sweep).
# std/ppr map directly; half_ppr (this app's third supported format) is
# approximated as the average of the standard and PPR ranks, since half-PPR
# scoring is literally the midpoint between the two and no better signal
# exists. Not a true average-draft-position (it's an integer rank position,
# same units Sleeper/Yahoo's ADP columns already just treat as sortable
# numbers), but it preserves the right relative ordering.
RANK_TYPE_BY_FORMAT = {"std": "STANDARD", "ppr": "PPR"}
SUPPORTED_FORMATS = ("std", "half_ppr", "ppr")


def fetch_raw_players(platform_league_id: str, client: httpx.Client | None = None) -> dict:
    """Players are fetched *through* a specific league's endpoint (ESPN has no
    league-independent player-list endpoint), but the ownership/rank data
    itself is platform-wide, not scoped to that league -- any saved ESPN
    league id works here purely as an access point.
    """
    season, league_id = split_league_id(platform_league_id)
    owns_client = client is None
    client = client or new_client()
    try:
        url = BASE_URL_TEMPLATE.format(season=season, league_id=league_id)
        filter_header = json.dumps(
            {
                "players": {
                    "limit": FETCH_LIMIT,
                    "sortDraftRanks": {
                        "sortPriority": 100,
                        "sortAsc": True,
                        "value": "STANDARD",
                    },
                }
            }
        )
        try:
            response = client.get(
                url,
                params={"view": "kona_player_info"},
                headers={"User-Agent": USER_AGENT, "x-fantasy-filter": filter_header},
                cookies=cookies(),
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise ESPNFetchError(f"Could not fetch ESPN players: {exc}") from exc
        except httpx.RequestError as exc:
            raise ESPNFetchError(f"Could not reach ESPN: {exc}") from exc

        raw = response.json()
        if not isinstance(raw, dict):
            raise ESPNFetchError("ESPN players response was not the expected shape")
        return raw
    finally:
        if owns_client:
            client.close()


def parse_players(raw: dict) -> list[dict]:
    """Normalize ESPN's raw player list into platform_players rows."""
    records = []
    for entry in raw.get("players") or []:
        player = entry.get("player") or {}
        player_id = player.get("id")
        full_name = player.get("fullName")
        if not player_id or not full_name:
            continue

        records.append(
            {
                "platform": PLATFORM,
                "platform_player_id": str(player_id),
                "name": full_name,
                "position": PLAYER_POSITION_MAP.get(player.get("defaultPositionId")),
                "team": PRO_TEAM_MAP.get(player.get("proTeamId")),
            }
        )
    return records


def parse_adp_entries(raw: dict, season: str) -> list[dict]:
    """Flatten ESPN's per-player rank buckets into one AdpEntry row per
    (player, format). See RANK_TYPE_BY_FORMAT's docstring for why half_ppr is
    an average of std/ppr rather than a direct ESPN field.
    """
    records = []
    for entry in raw.get("players") or []:
        player = entry.get("player") or {}
        player_id = player.get("id")
        if not player_id:
            continue

        ranks = player.get("draftRanksByRankType") or {}
        rank_by_format: dict[str, float] = {}
        for fmt, rank_type in RANK_TYPE_BY_FORMAT.items():
            rank = (ranks.get(rank_type) or {}).get("rank")
            if rank is not None:
                rank_by_format[fmt] = float(rank)

        if "std" in rank_by_format and "ppr" in rank_by_format:
            rank_by_format["half_ppr"] = (rank_by_format["std"] + rank_by_format["ppr"]) / 2

        for fmt in SUPPORTED_FORMATS:
            if fmt not in rank_by_format:
                continue
            records.append(
                {
                    "platform": PLATFORM,
                    "platform_player_id": str(player_id),
                    "season": season,
                    "format": fmt,
                    "adp": rank_by_format[fmt],
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


def sync(session: Session, platform_league_id: str, season: str) -> dict:
    raw = fetch_raw_players(platform_league_id)
    player_records = parse_players(raw)
    adp_records = parse_adp_entries(raw, season)
    players_synced = upsert_players(session, player_records)
    adp_synced = upsert_adp_entries(session, adp_records)
    return {"players_synced": players_synced, "adp_synced": adp_synced}
