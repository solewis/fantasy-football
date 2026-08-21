"""Per-platform ingest module dispatch.

A dict of *modules* (not a dict of functions) is deliberate: existing tests
mock a Sleeper fetch with `monkeypatch.setattr(sleeper_league, "fetch_raw_league", ...)`,
which patches the module's own attribute. A dict of bound function
references would capture the original (unpatched) function at import time,
and every existing test would silently start hitting the live Sleeper API.
Looking up `LEAGUE_INGEST["sleeper"].fetch_raw_league` at call time preserves
that seam.

Two separate maps, not one shared adapter object/Protocol, since platforms
have genuinely different capability sets (Sleeper has an ad-hoc "paste a raw
draft ID" path nothing else has; ESPN/Yahoo need a saved League to draft
from at all) -- a single interface forced over all of them would grow
NotImplementedError holes within one platform rather than a clean "this
platform doesn't support that" error at one place.
"""

from app.ingest import sleeper_draft, sleeper_league

LEAGUE_INGEST = {
    "sleeper": sleeper_league,
}

DRAFT_INGEST = {
    "sleeper": sleeper_draft,
}

# For user-facing strings ("synced live from X") -- title() mangles acronyms
# like "espn" -> "Espn", so this is spelled out explicitly per platform.
DISPLAY_NAMES = {
    "sleeper": "Sleeper",
    "espn": "ESPN",
    "yahoo": "Yahoo",
}


class UnsupportedPlatformError(ValueError):
    """A platform string that has no registered ingest module."""


def league_ingest(platform: str):
    try:
        return LEAGUE_INGEST[platform]
    except KeyError:
        raise UnsupportedPlatformError(f"Unsupported platform: {platform!r}") from None


def draft_ingest(platform: str):
    try:
        return DRAFT_INGEST[platform]
    except KeyError:
        raise UnsupportedPlatformError(f"Unsupported platform: {platform!r}") from None
