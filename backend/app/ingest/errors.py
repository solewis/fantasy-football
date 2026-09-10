class PlatformFetchError(Exception):
    """A platform's league/draft/players lookup failed or returned something
    unusable. The shared base every platform-specific fetch error (Sleeper's
    SleeperFetchError, ESPN's, ...) inherits from, so service-layer code
    (app/league.py, app/draft.py) can catch failures generically without
    needing to know which platform's ingest module raised them.
    """
