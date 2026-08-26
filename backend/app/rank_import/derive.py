"""Turn parsed rows into the uniform shape everything downstream reads.

Pure, like parse.py. The one rule worth stating up front, because it governs
what an imported file can and can't be used for:

    A positional rank can be derived from an overall rank. An overall rank
    cannot be derived from positional ranks.

Going overall -> positional just means "sort the WRs by their overall rank and
number them", which is exactly what WR3 means in an overall list -- no
information is invented. Going the other way would mean interleaving QB1, RB1
and WR1 into a single order, and nothing in the file says whether QB1 goes
before or after RB1. That needs value information (projected points, VOR, ADP)
a ranking file doesn't carry, so a positional-only dataset simply can't feed an
overall build, and says so rather than guessing.
"""

from dataclasses import dataclass, field

from app.matching.normalize import normalize_name
from app.rank_import.parse import RawRankRow


@dataclass(frozen=True)
class DerivedRankRow:
    row_index: int
    source_name_raw: str
    normalized_name: str
    position: str | None
    team: str | None
    overall_rank: int | None
    position_rank: int | None
    position_rank_derived: bool
    tier: int | None


@dataclass(frozen=True)
class DerivedDataset:
    rows: list[DerivedRankRow]
    has_overall: bool
    has_positional: bool
    has_tier: bool
    warnings: list[str] = field(default_factory=list)


def derive_dataset(raw_rows: list[RawRankRow]) -> DerivedDataset:
    warnings: list[str] = []

    # Dedupe on (normalized name, position). The DB constraint catches most of
    # this, but not rows with a null position (SQL treats nulls as distinct),
    # so it happens here too -- and here we can say which rows collided.
    seen: dict[tuple[str, str | None], DerivedRankRow] = {}
    ordered: list[DerivedRankRow] = []

    for raw in raw_rows:
        normalized = normalize_name(raw.name)
        if not normalized:
            warnings.append(f"Row {raw.row_index + 1}: couldn't read a player name, skipped")
            continue

        key = (normalized, raw.position)
        if key in seen:
            warnings.append(
                f"{raw.name!r} appears more than once at {raw.position or 'no position'}; "
                f"kept the first (better-ranked) one"
            )
            continue

        row = DerivedRankRow(
            row_index=raw.row_index,
            source_name_raw=raw.name,
            normalized_name=normalized,
            position=raw.position,
            team=raw.team,
            overall_rank=raw.overall_rank,
            position_rank=raw.position_rank,
            position_rank_derived=False,
            tier=raw.tier,
        )
        seen[key] = row
        ordered.append(row)

    ordered = _derive_position_ranks(ordered)

    ties = _count_tied_overall(ordered)
    if ties:
        warnings.append(
            f"{ties} player(s) share an overall rank with another; original file order breaks the tie"
        )

    return DerivedDataset(
        rows=ordered,
        has_overall=any(r.overall_rank is not None for r in ordered),
        has_positional=any(r.position_rank is not None for r in ordered),
        has_tier=any(r.tier is not None for r in ordered),
        warnings=warnings,
    )


def _derive_position_ranks(rows: list[DerivedRankRow]) -> list[DerivedRankRow]:
    """Fill in position_rank for rows that have an overall rank but no
    positional one, by ranking within each position.

    Rows that already carry a positional rank keep it verbatim, even where it
    disagrees with the order their overall ranks imply -- that disagreement is
    what the source actually published, and quietly "fixing" it would misreport
    them in the builder.
    """
    needs_derivation = [
        r
        for r in rows
        if r.position_rank is None and r.overall_rank is not None and r.position is not None
    ]
    if not needs_derivation:
        return rows

    by_position: dict[str, list[DerivedRankRow]] = {}
    for row in needs_derivation:
        by_position.setdefault(row.position, []).append(row)

    derived: dict[int, int] = {}
    for position_rows in by_position.values():
        # Ties fall back to file order, so the result is deterministic.
        ordered = sorted(position_rows, key=lambda r: (r.overall_rank, r.row_index))
        for index, row in enumerate(ordered):
            derived[id(row)] = index + 1

    result: list[DerivedRankRow] = []
    for row in rows:
        rank = derived.get(id(row))
        if rank is None:
            result.append(row)
            continue
        result.append(
            DerivedRankRow(
                row_index=row.row_index,
                source_name_raw=row.source_name_raw,
                normalized_name=row.normalized_name,
                position=row.position,
                team=row.team,
                overall_rank=row.overall_rank,
                position_rank=rank,
                position_rank_derived=True,
                tier=row.tier,
            )
        )
    return result


def _count_tied_overall(rows: list[DerivedRankRow]) -> int:
    seen: dict[int, int] = {}
    for row in rows:
        if row.overall_rank is not None:
            seen[row.overall_rank] = seen.get(row.overall_rank, 0) + 1
    return sum(count for count in seen.values() if count > 1)
