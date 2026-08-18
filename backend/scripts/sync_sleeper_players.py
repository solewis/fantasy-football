"""Fetch Sleeper's full player list and upsert it into platform_players.

Usage: python scripts/sync_sleeper_players.py (run from backend/)
"""

from app.db import Base, SessionLocal, engine
from app.ingest import sleeper


def main() -> None:
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        count = sleeper.sync(session)
    print(f"Synced {count} Sleeper players")


if __name__ == "__main__":
    main()
