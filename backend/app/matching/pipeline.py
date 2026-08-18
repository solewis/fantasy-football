from sqlalchemy.orm import Session

from app.matching.candidates import build_exact_index, build_index
from app.matching.mappings import get_mapping
from app.matching.normalize import normalize_name
from app.matching.resolve import resolve_one


def resolve_rows(
    session: Session,
    platform: str,
    source_type: str,
    rows: list[dict],
    platform_players: list[dict],
) -> list[dict]:
    """Resolve a batch of source rows ({"name", "position"}) against a platform's player list.

    Checks for a previously confirmed mapping before doing any fuzzy-matching work,
    so re-importing the same source only spends effort on genuinely new names.
    """
    fuzzy_index = build_index(platform_players)
    exact_index = build_exact_index(fuzzy_index)

    results = []
    for row in rows:
        name = row["name"]
        position = row.get("position")
        normalized = normalize_name(name)
        mapping = get_mapping(session, platform, source_type, normalized)

        if mapping:
            result = resolve_one(
                name,
                position,
                exact_index,
                fuzzy_index,
                mapped_player_id=mapping.platform_player_id,
                has_mapping=True,
            )
        else:
            result = resolve_one(name, position, exact_index, fuzzy_index)

        result["source_name_raw"] = name
        results.append(result)

    return results
