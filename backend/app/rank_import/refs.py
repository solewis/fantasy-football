"""Tagged references to a rank source.

One string identifies any of the three things that can supply ranks: "adp",
"dataset:7", "rank_set:3". A single opaque string rather than a
(kind, id) pair everywhere means the frontend, the request bodies and
RankSetSource.ref all carry the same thing, and a fourth source kind later
costs no schema change -- the same reasoning that makes NameMapping.source_type
free text.
"""

ADP = "adp"
DATASET = "dataset"
RANK_SET = "rank_set"

_ID_KINDS = (DATASET, RANK_SET)


class RankRefError(ValueError):
    """A source reference that can't be parsed."""


def format_source_ref(kind: str, source_id: int | None = None) -> str:
    if kind == ADP:
        return ADP
    if kind not in _ID_KINDS:
        raise RankRefError(f"Unknown source kind {kind!r}")
    if source_id is None:
        raise RankRefError(f"Source kind {kind!r} needs an id")
    return f"{kind}:{source_id}"


def parse_source_ref(ref: str) -> tuple[str, int | None]:
    """Inverse of format_source_ref.

    Raises rather than returning something empty on an unrecognized ref. Refs
    arrive from request bodies, and a silently-empty source reads identically
    to "this source has no opinion about anyone" three layers downstream --
    the builder would render every candidate as unranked and look broken.
    """
    if ref == ADP:
        return ADP, None

    kind, separator, raw_id = ref.partition(":")
    if not separator or kind not in _ID_KINDS:
        raise RankRefError(f"Unknown source reference {ref!r}")
    try:
        return kind, int(raw_id)
    except ValueError as exc:
        raise RankRefError(f"Source reference {ref!r} has a non-numeric id") from exc
