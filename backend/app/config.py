"""App-wide config, loaded from a local .env (gitignored) via python-dotenv.

Sleeper needs no credentials at all, so this module didn't exist until a
second platform needed some. Kept intentionally minimal: plain env vars, no
config framework, matching this project's general preference for the
smallest thing that works over a generic settings layer.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

_ENV_PATH = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(_ENV_PATH)

# ESPN has no OAuth -- these are just the espn_s2/SWID cookie values copied
# from a logged-in browser session (see backend/.env.example for how to get
# them). Public leagues need neither; a private league 401s without both.
ESPN_S2 = os.environ.get("ESPN_S2")
ESPN_SWID = os.environ.get("ESPN_SWID")
