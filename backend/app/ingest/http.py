import ssl

import httpx
import truststore


def new_client() -> httpx.Client:
    """A truststore-backed httpx client, shared by every ingest module that
    talks to a platform's REST API directly (Sleeper, ESPN, ...).

    httpx defaults to its bundled certifi CA store, which can lag behind
    newer intermediate CAs (and won't include a corporate TLS-inspection
    root either). truststore delegates verification to the OS's native
    trust store instead, same as curl, so it stays correct without pinning
    a static CA bundle file. Originally written for Sleeper; every ingest
    module hitting a platform's REST API directly should use this rather
    than reaching for verify=False.
    """
    ctx = truststore.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    return httpx.Client(timeout=30, verify=ctx)
