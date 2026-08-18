from app.matching.candidates import find_candidates
from app.matching.normalize import normalize_name

AUTO_MATCHED = "auto_matched"
CONFIRMED_NO_MATCH = "confirmed_no_match"
NEEDS_REVIEW = "needs_review"


def resolve_one(
    name: str,
    position: str | None,
    exact_index: dict[str, list[dict]],
    fuzzy_index: list[tuple[str, dict]],
    mapped_player_id: str | None = None,
    has_mapping: bool = False,
) -> dict:
    """Resolve one source name to a platform player, or flag it for manual review.

    A previously confirmed mapping always short-circuits everything else — that's
    what makes repeat imports fast. Otherwise: an unambiguous normalized-name match
    auto-resolves; an ambiguous one (e.g. two players sharing a name) is
    disambiguated by position if possible; anything else falls back to fuzzy
    matching and always needs manual review, since fuzzy matches are never certain.
    """
    normalized = normalize_name(name)

    if has_mapping:
        status = CONFIRMED_NO_MATCH if mapped_player_id is None else AUTO_MATCHED
        return {
            "status": status,
            "normalized_name": normalized,
            "platform_player_id": mapped_player_id,
            "candidates": [],
        }

    exact_matches = exact_index.get(normalized, [])
    if len(exact_matches) == 1:
        return {
            "status": AUTO_MATCHED,
            "normalized_name": normalized,
            "platform_player_id": exact_matches[0]["platform_player_id"],
            "candidates": [],
        }

    if len(exact_matches) > 1 and position:
        position_matches = [p for p in exact_matches if p.get("position") == position]
        if len(position_matches) == 1:
            return {
                "status": AUTO_MATCHED,
                "normalized_name": normalized,
                "platform_player_id": position_matches[0]["platform_player_id"],
                "candidates": [],
            }

    if exact_matches:
        candidates = [{**p, "score": 100.0} for p in exact_matches]
    else:
        candidates = find_candidates(normalized, fuzzy_index, position=position)

    return {
        "status": NEEDS_REVIEW,
        "normalized_name": normalized,
        "platform_player_id": None,
        "candidates": candidates,
    }
