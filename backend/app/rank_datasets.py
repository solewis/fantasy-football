"""Import and manage third-party ranking datasets.

A dataset is stored platform-agnostically: its rows are keyed by normalized
name, and resolving those names to Sleeper or ESPN player ids happens on read
(app/rank_sources.py). That's what lets one uploaded file serve both a Sleeper
and an ESPN league.

Name resolution decisions persist in NameMapping under a single shared
source_type, RANK_CSV_SOURCE_TYPE, rather than one per dataset. Confirming
"Ja'Marr Chase" once should serve every file you ever import; per-dataset
source types would mean re-reviewing hundreds of names per file. The trade-off
is that one bad confirmation affects every dataset at once -- acceptable for a
single-user tool, and one request to correct.
"""

from dataclasses import asdict
from datetime import UTC, datetime

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.db import as_utc
from app.matching.mappings import confirm_mapping, get_mappings
from app.matching.pipeline import resolve_rows
from app.models import NameMapping, PlatformPlayer, RankDataset, RankDatasetEntry, RankSetSource
from app.rank_import.derive import DerivedDataset, derive_dataset
from app.rank_import.parse import ColumnMapping, preview

RANK_CSV_SOURCE_TYPE = "rank_csv"

# preview() caps its returned rows; the importer wants all of them.
_ALL_ROWS = 1_000_000


class RankDatasetError(ValueError):
    """A dataset action that can't be satisfied (duplicate name, unknown id, ...)."""


def preview_dataset(text: str, mapping: ColumnMapping | None = None) -> dict:
    """Parse far enough to show the user what we think the columns mean."""
    result = preview(text, mapping=mapping)
    derived = derive_dataset(result.sample_rows)
    return {
        "delimiter": result.delimiter,
        "header_row_index": result.header_row_index,
        "columns": result.columns,
        "mapping": asdict(result.mapping),
        "confidence": result.confidence,
        "row_count": result.row_count,
        "sample_rows": [asdict(row) for row in derived.rows],
        "detected": {
            "has_overall": derived.has_overall,
            "has_positional": derived.has_positional,
            "has_tier": derived.has_tier,
        },
        "warnings": [*result.warnings, *derived.warnings],
    }


def _derive_from_text(text: str, mapping: ColumnMapping | None) -> tuple[DerivedDataset, dict]:
    """Parse every row (not just a sample) and derive. sample_size is what
    bounds preview()'s output; here we want the whole file.
    """
    parsed = preview(text, mapping=mapping, sample_size=_ALL_ROWS)
    return derive_dataset(parsed.sample_rows), asdict(parsed.mapping)


def create_dataset(
    session: Session,
    name: str,
    season: str,
    format: str,
    text: str,
    mapping: ColumnMapping | None = None,
    source_filename: str | None = None,
) -> RankDataset:
    name = name.strip()
    if not name:
        raise RankDatasetError("Dataset name can't be blank")

    existing = (
        session.query(RankDataset).filter_by(season=season, format=format, name=name).one_or_none()
    )
    if existing:
        raise RankDatasetError(f"A dataset named {name!r} already exists for this format")

    derived, mapping_dict = _derive_from_text(text, mapping)
    if not derived.rows:
        raise RankDatasetError("No usable rows were found in this file")

    dataset = RankDataset(
        name=name,
        season=season,
        format=format,
        has_overall=derived.has_overall,
        has_positional=derived.has_positional,
        has_tier=derived.has_tier,
        row_count=len(derived.rows),
        source_filename=source_filename,
        column_mapping=mapping_dict,
        raw_text=text,
        imported_at=datetime.now(UTC),
    )
    session.add(dataset)
    session.commit()
    session.refresh(dataset)

    _write_entries(session, dataset, derived)
    return dataset


def reparse_dataset(session: Session, dataset_id: int, mapping: ColumnMapping) -> RankDataset:
    """Re-derive a dataset from its stored text with a corrected mapping.

    Keeps the same dataset id, so anything already referencing it (a rank set's
    saved source list) keeps working -- which is the reason raw_text is stored
    at all rather than discarded after import.
    """
    dataset = get_dataset(session, dataset_id)
    if dataset is None:
        raise RankDatasetError("Dataset not found")

    derived, mapping_dict = _derive_from_text(dataset.raw_text, mapping)
    if not derived.rows:
        raise RankDatasetError("That column mapping produced no usable rows")

    dataset.has_overall = derived.has_overall
    dataset.has_positional = derived.has_positional
    dataset.has_tier = derived.has_tier
    dataset.row_count = len(derived.rows)
    dataset.column_mapping = mapping_dict
    session.commit()

    _write_entries(session, dataset, derived)
    return dataset


def _write_entries(session: Session, dataset: RankDataset, derived: DerivedDataset) -> None:
    session.query(RankDatasetEntry).filter_by(dataset_id=dataset.id).delete()
    for row in derived.rows:
        session.add(
            RankDatasetEntry(
                dataset_id=dataset.id,
                source_name_raw=row.source_name_raw,
                normalized_name=row.normalized_name,
                position=row.position,
                team=row.team,
                overall_rank=row.overall_rank,
                position_rank=row.position_rank,
                tier=row.tier,
                position_rank_derived=row.position_rank_derived,
                row_index=row.row_index,
            )
        )
    session.commit()


def get_dataset(session: Session, dataset_id: int) -> RankDataset | None:
    return session.get(RankDataset, dataset_id)


def _summary(dataset: RankDataset) -> dict:
    return {
        "id": dataset.id,
        "name": dataset.name,
        "season": dataset.season,
        "format": dataset.format,
        "has_overall": dataset.has_overall,
        "has_positional": dataset.has_positional,
        "has_tier": dataset.has_tier,
        "row_count": dataset.row_count,
        "source_filename": dataset.source_filename,
        "imported_at": as_utc(dataset.imported_at),
    }


def list_datasets(
    session: Session,
    season: str | None = None,
    format: str | None = None,
    platform: str | None = None,
) -> list[dict]:
    """Datasets in scope, with per-platform name-resolution counts when a
    platform is given.

    A dataset itself is platform-neutral -- it's stored by normalized name so
    one upload serves every platform. Only the *resolution* is per-platform,
    since a name has to land on one platform's player id, and Sleeper's and
    ESPN's id spaces are unrelated. That's why the counts need a platform and
    the rest of the row doesn't.
    """
    query = session.query(RankDataset)
    if season is not None:
        query = query.filter(RankDataset.season == season)
    if format is not None:
        query = query.filter(RankDataset.format == format)
    datasets = query.order_by(RankDataset.id.asc()).all()

    rows = []
    for dataset in datasets:
        summary = _summary(dataset)
        if platform is not None:
            # Runs the matcher, which is what makes the count trustworthy:
            # counting rows with no stored mapping would report every
            # auto-matchable name as needing review. Names already confirmed
            # short-circuit on a batched lookup, so the repeat cost is small.
            summary["resolution"] = auto_confirm_matches(session, dataset.id, platform)
        rows.append(summary)
    return rows


def rename_dataset(session: Session, dataset_id: int, name: str) -> RankDataset:
    dataset = get_dataset(session, dataset_id)
    if dataset is None:
        raise RankDatasetError("Dataset not found")

    name = name.strip()
    if not name:
        raise RankDatasetError("Dataset name can't be blank")

    clash = (
        session.query(RankDataset)
        .filter_by(season=dataset.season, format=dataset.format, name=name)
        .filter(RankDataset.id != dataset_id)
        .one_or_none()
    )
    if clash:
        raise RankDatasetError(f"A dataset named {name!r} already exists for this format")

    dataset.name = name
    session.commit()
    return dataset


def delete_dataset(session: Session, dataset_id: int) -> None:
    dataset = get_dataset(session, dataset_id)
    if dataset is None:
        raise RankDatasetError("Dataset not found")

    # No PRAGMA foreign_keys=ON in this app, so children are cleared explicitly
    # -- same pattern as delete_rank_set. A RankSetSource pointing at a deleted
    # dataset would make its rank set unopenable in the builder.
    session.query(RankDatasetEntry).filter_by(dataset_id=dataset_id).delete()
    session.query(RankSetSource).filter_by(ref=f"dataset:{dataset_id}").delete()
    session.delete(dataset)
    session.commit()


def _platform_player_dicts(session: Session, platform: str) -> list[dict]:
    rows = session.query(PlatformPlayer).filter_by(platform=platform).all()
    return [
        {
            "platform_player_id": p.platform_player_id,
            "name": p.name,
            "position": p.position,
            "team": p.team,
        }
        for p in rows
    ]


def resolve_dataset_names(session: Session, dataset_id: int, platform: str) -> list[dict]:
    """Run every unresolved name in the dataset through the matching pipeline.

    Names with a confirmed mapping are skipped entirely -- the pipeline handles
    that, and it's what makes a second import of a similar file nearly
    review-free.
    """
    dataset = get_dataset(session, dataset_id)
    if dataset is None:
        raise RankDatasetError("Dataset not found")

    entries = session.query(RankDatasetEntry).filter_by(dataset_id=dataset_id).all()
    rows = [
        {"name": e.source_name_raw, "position": e.position, "normalized_name": e.normalized_name}
        for e in entries
    ]
    return resolve_rows(
        session, platform, RANK_CSV_SOURCE_TYPE, rows, _platform_player_dicts(session, platform)
    )


def auto_confirm_matches(session: Session, dataset_id: int, platform: str) -> dict:
    """Persist every auto-matched name, so later reads resolve without
    re-running the fuzzy matcher, and return what's left for a human.
    """
    resolved = resolve_dataset_names(session, dataset_id, platform)

    auto_matched = 0
    for row in resolved:
        if row["status"] == "auto_matched" and row["platform_player_id"] is not None:
            existing = get_mappings(
                session, platform, RANK_CSV_SOURCE_TYPE, [row["normalized_name"]]
            )
            if row["normalized_name"] not in existing:
                confirm_mapping(
                    session,
                    platform,
                    RANK_CSV_SOURCE_TYPE,
                    row["source_name_raw"],
                    row["normalized_name"],
                    row["platform_player_id"],
                    commit=False,
                )
                auto_matched += 1
    session.commit()

    needs_review = sum(1 for row in resolved if row["status"] == "needs_review")
    return {"matched": len(resolved) - needs_review, "needs_review": needs_review}


def list_unmatched(session: Session, dataset_id: int, platform: str) -> list[dict]:
    """Names still needing a human decision, with ranked candidates."""
    resolved = resolve_dataset_names(session, dataset_id, platform)

    seen: set[str] = set()
    unmatched = []
    for row in resolved:
        if row["status"] != "needs_review" or row["normalized_name"] in seen:
            continue
        seen.add(row["normalized_name"])
        unmatched.append(
            {
                "normalized_name": row["normalized_name"],
                "source_name_raw": row["source_name_raw"],
                "position": row.get("position"),
                "candidates": row["candidates"],
            }
        )
    return unmatched


def confirm_names(session: Session, platform: str, confirmations: list[dict]) -> int:
    """Persist a batch of human decisions as one transaction.

    platform_player_id=None records a confirmed "not a player", which
    NameMapping already models -- so that name never gets asked about again.
    """
    for entry in confirmations:
        confirm_mapping(
            session,
            platform,
            RANK_CSV_SOURCE_TYPE,
            entry.get("source_name_raw") or entry["normalized_name"],
            entry["normalized_name"],
            entry.get("platform_player_id"),
            commit=False,
        )
    session.commit()
    return len(confirmations)


def count_resolved_rows(session: Session, platform: str) -> int:
    """How many dataset rows across every dataset now resolve to a player.

    Backs the "also fixed 2 rows in your other datasets" line -- the payoff for
    reviewing a name once instead of once per file.
    """
    return (
        session.query(func.count(RankDatasetEntry.id))
        .join(
            NameMapping,
            NameMapping.normalized_name == RankDatasetEntry.normalized_name,
        )
        .filter(
            NameMapping.platform == platform,
            NameMapping.source_type == RANK_CSV_SOURCE_TYPE,
            NameMapping.platform_player_id.isnot(None),
        )
        .scalar()
        or 0
    )
