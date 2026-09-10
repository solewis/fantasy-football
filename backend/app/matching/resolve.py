from app.matching.candidates import find_candidates
from app.matching.normalize import normalize_name

AUTO_MATCHED = "auto_matched"
CONFIRMED_NO_MATCH = "confirmed_no_match"
NEEDS_REVIEW = "needs_review"

# A fuzzy score at or above this, with a matching position and no runner-up
# close behind, auto-matches instead of going to review.
#
# Without a threshold every non-exact name lands in the review queue -- a
# 400-row import means a human clicking through 40-odd obvious matches
# ("Marvin Harrison Jr" vs "Marvin Harrison"), which is enough friction to make
# the feature not worth using. Set high on purpose: the cost of a wrong
# auto-match (a silently mis-ranked player on draft day) is much higher than
# the cost of one extra review.
AUTO_MATCH_SCORE = 92.0
# ...and only when the next candidate is clearly worse, so two similarly-named
# players never auto-resolve to whichever happened to score a hair higher.
AUTO_MATCH_MARGIN = 6.0


def resolve_one(
    name: str,
    position: str | None,
    exact_index: dict[str, list[dict]],
    fuzzy_index: list[tuple[str, dict]],
    mapped_player_id: str | None = None,
    has_mapping: bool = False,
    choices: dict[int, str] | None = None,
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
        candidates = find_candidates(normalized, fuzzy_index, position=position, choices=choices)

        if _is_confident(candidates, position):
            return {
                "status": AUTO_MATCHED,
                "normalized_name": normalized,
                "platform_player_id": candidates[0]["platform_player_id"],
                "candidates": candidates,
            }

    return {
        "status": NEEDS_REVIEW,
        "normalized_name": normalized,
        "platform_player_id": None,
        "candidates": candidates,
    }


def _is_confident(candidates: list[dict], position: str | None) -> bool:
    """Whether the top fuzzy candidate is safe to accept without a human.

    Requires a position on both sides: a row with no position can't be checked
    against anything, and "high score" alone is how you match a WR to a
    similarly-named linebacker.
    """
    if not candidates or position is None:
        return False
    top = candidates[0]
    if top["score"] < AUTO_MATCH_SCORE or top.get("position") != position:
        return False
    runner_up = next((c for c in candidates[1:] if c.get("position") == position), None)
    return runner_up is None or top["score"] - runner_up["score"] >= AUTO_MATCH_MARGIN
