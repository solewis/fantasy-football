"""Fetch ESPN's player list + ADP and upsert into platform_players/adp_entries.

Uses a saved ESPN League purely as the access point (the player/ADP data
itself isn't scoped to that one league) -- defaults to whichever ESPN
league was saved first if no --league-id is given.

Usage: python -m scripts.sync_espn_players [--league-id ID]  (run from backend/)
"""

import argparse

from app.db import Base, SessionLocal, engine
from app.sync_service import sync_espn_players


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--league-id", type=int, default=None)
    args = parser.parse_args()

    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        result = sync_espn_players(session, args.league_id)
    print(
        f"Synced {result['record_count']} ESPN players and {result['adp_record_count']} ADP entries"
    )


if __name__ == "__main__":
    main()
