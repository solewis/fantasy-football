"""Fetch Sleeper's full player list and upsert it into platform_players.

Usage: python -m scripts.sync_sleeper_players (run from backend/)
"""

from app.db import SessionLocal
from app.sync_service import sync_players


def main() -> None:
    with SessionLocal() as session:
        result = sync_players(session)
    print(f"Synced {result['record_count']} Sleeper players")


if __name__ == "__main__":
    main()
