"""Fetch Sleeper's ADP (via its projections endpoint) and upsert into adp_entries.

Usage: python -m scripts.sync_sleeper_adp [season]  (run from backend/, default season 2026)
"""

import sys

from app.db import Base, SessionLocal, engine
from app.ingest import sleeper_adp

DEFAULT_SEASON = "2026"


def main() -> None:
    season = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SEASON

    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        count = sleeper_adp.sync(session, season)
    print(f"Synced {count} ADP entries for season {season}")


if __name__ == "__main__":
    main()
