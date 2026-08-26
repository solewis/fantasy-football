from sqlalchemy.orm import Session

from app.matching.candidates import build_choices, build_exact_index, build_index, fantasy_players
from app.matching.mappings import get_mappings
from app.matching.normalize import normalize_name
from app.matching.resolve import resolve_one


def resolve_rows(
    session: Session,
    platform: str,
    source_type: str,
    rows: list[dict],
    platform_players: list[dict],
) -> list[dict]:
    """Resolve a batch of source rows ({"name", "position", ...}) against a platform's player list.

    Previously confirmed mappings are read in one query up front and
    short-circuit everything else, so re-importing a source only spends effort
    on genuinely new names.

    Each input row is merged into its result, so callers keep whatever else the
    row carried (rank, tier, row_index). Without that the importer would have
    to re-associate results with inputs by position in the list, which is
    exactly the kind of thing that silently misaligns.
    """
    fuzzy_index = build_index(fantasy_players(platform_players))
    exact_index = build_exact_index(fuzzy_index)
    choices = build_choices(fuzzy_index)

    normalized_names = [normalize_name(row["name"]) for row in rows]
    mappings = get_mappings(session, platform, source_type, normalized_names)

    results = []
    for row, normalized in zip(rows, normalized_names, strict=True):
        mapping = mappings.get(normalized)
        result = resolve_one(
            row["name"],
            row.get("position"),
            exact_index,
            fuzzy_index,
            mapped_player_id=mapping.platform_player_id if mapping else None,
            has_mapping=mapping is not None,
            choices=choices,
        )
        results.append({**row, **result, "source_name_raw": row["name"]})

    return results
