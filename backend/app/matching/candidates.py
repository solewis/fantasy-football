from rapidfuzz import fuzz, process

from app.matching.normalize import normalize_name

# Fantasy-relevant positions. Sleeper's player list carries 11,500+ rows across
# 30-odd positions (1,162 LB, 607 OL, ...), and fuzzy-matching a WR against a
# practice-squad long snapper with a similar name is how you get a confidently
# wrong auto-match -- filtering is as much about correctness as speed.
FANTASY_POSITIONS = frozenset({"QB", "RB", "WR", "TE", "K", "DEF"})


def fantasy_players(platform_players: list[dict]) -> list[dict]:
    return [p for p in platform_players if p.get("position") in FANTASY_POSITIONS]


def build_index(platform_players: list[dict]) -> list[tuple[str, dict]]:
    """Precompute (normalized_name, player) pairs once, reused across many resolve calls."""
    return [(normalize_name(p["name"]), p) for p in platform_players]


def build_choices(index: list[tuple[str, dict]]) -> dict[int, str]:
    """The rapidfuzz choices mapping, built once per index rather than per call.

    This used to be rebuilt inside find_candidates for every unmatched row,
    which defeated build_index's whole purpose -- a 400-row import against a
    12k-player list constructed millions of dict entries.
    """
    return {i: entry[0] for i, entry in enumerate(index)}


def build_exact_index(index: list[tuple[str, dict]]) -> dict[str, list[dict]]:
    """Group players by normalized name, to detect both exact matches and name collisions."""
    groups: dict[str, list[dict]] = {}
    for normalized, player in index:
        groups.setdefault(normalized, []).append(player)
    return groups


def find_candidates(
    normalized_name: str,
    index: list[tuple[str, dict]],
    position: str | None = None,
    limit: int = 5,
    choices: dict[int, str] | None = None,
) -> list[dict]:
    """Fuzzy-match a normalized name against the platform player index.

    Uses token_set_ratio (not token_sort_ratio) because it scores well when one
    name's tokens are a subset of the other's — the common case for DST entries
    ("49ers" vs "San Francisco 49ers") and partial/nickname names.
    """
    if choices is None:
        choices = build_choices(index)
    matches = process.extract(normalized_name, choices, scorer=fuzz.token_set_ratio, limit=limit)

    candidates = []
    for _, score, idx in matches:
        player = index[idx][1]
        bonus = 5 if position and player.get("position") == position else 0
        candidates.append({**player, "score": round(min(100.0, score + bonus), 1)})

    candidates.sort(key=lambda c: c["score"], reverse=True)
    return candidates
