"""Load rank sources and assemble the pool the builder reads.

Three different things can supply ranks -- an imported dataset, ADP, and one of
your own rank sets -- and the builder consumes all three identically. That's
what this module is for.

Deliberately opinion-free. It reports what each source says about each player
and stops there: no averaging, no scoring, no ordering by anything but id. Every
derived number (average, range, coverage, delta, colour) is display logic and
lives in the frontend, which also has to recompute it on every pick anyway.
"""

from dataclasses import dataclass, field

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.matching.mappings import get_mappings
from app.models import AdpEntry, PlatformPlayer, RankDataset, RankDatasetEntry, RankEntry, RankSet
from app.rank_datasets import RANK_CSV_SOURCE_TYPE
from app.rank_import.refs import ADP, DATASET, RANK_SET, format_source_ref, parse_source_ref
from app.ranks import OVERALL


class RankSourceError(ValueError):
    """A rank source that can't be loaded, or can't serve the axis requested."""


@dataclass(frozen=True)
class SourceRank:
    overall_rank: int | None = None
    position_rank: int | None = None
    tier: int | None = None


@dataclass(frozen=True)
class RankSource:
    ref: str
    label: str
    kind: str
    supports_overall: bool
    supports_positional: bool
    # platform_player_id -> what this source says about them
    ranks: dict[str, SourceRank] = field(default_factory=dict)
    # Source names with no confirmed mapping for this platform.
    unresolved: list[str] = field(default_factory=list)
    # Deepest rank this source publishes, per axis ("overall", "WR", ...). Lets
    # the UI distinguish "left this player off" from "only ranks 150 players",
    # which are very different facts at pick 200.
    depth: dict[str, int] = field(default_factory=dict)


def _depths(ranks: dict[str, SourceRank], positions: dict[str, str | None]) -> dict[str, int]:
    depth: dict[str, int] = {}
    for player_id, rank in ranks.items():
        if rank.overall_rank is not None:
            depth["overall"] = max(depth.get("overall", 0), rank.overall_rank)
        position = positions.get(player_id)
        if position and rank.position_rank is not None:
            depth[position] = max(depth.get(position, 0), rank.position_rank)
    return depth


def _player_positions(session: Session, platform: str) -> dict[str, str | None]:
    return {
        p.platform_player_id: p.position
        for p in session.query(PlatformPlayer).filter_by(platform=platform).all()
    }


def _load_adp(session: Session, platform: str, season: str, format: str) -> RankSource:
    """ADP as a rank source.

    overall_rank is the player's *position in the ADP ordering*, 1..n -- not the
    ADP float. This matters more than it looks: an ADP of 4.7 is an estimated
    pick number, and comparing it to "the 5th slot in my list" is comparing two
    different units. Ranking the list first makes it directly comparable to
    every other source.
    """
    rows = (
        session.query(PlatformPlayer, AdpEntry.adp)
        .join(
            AdpEntry,
            and_(
                AdpEntry.platform == PlatformPlayer.platform,
                AdpEntry.platform_player_id == PlatformPlayer.platform_player_id,
            ),
        )
        .filter(
            PlatformPlayer.platform == platform,
            AdpEntry.season == season,
            AdpEntry.format == format,
        )
        .order_by(AdpEntry.adp.asc())
        .all()
    )

    ranks: dict[str, SourceRank] = {}
    per_position: dict[str, int] = {}
    for index, (player, _adp) in enumerate(rows):
        position_rank = None
        if player.position:
            per_position[player.position] = per_position.get(player.position, 0) + 1
            position_rank = per_position[player.position]
        ranks[player.platform_player_id] = SourceRank(
            overall_rank=index + 1, position_rank=position_rank
        )

    positions = {p.platform_player_id: p.position for p, _ in rows}
    return RankSource(
        ref=ADP,
        label="ADP",
        kind=ADP,
        supports_overall=True,
        supports_positional=True,
        ranks=ranks,
        depth=_depths(ranks, positions),
    )


def _load_dataset(session: Session, dataset_id: int, platform: str) -> RankSource:
    dataset = session.get(RankDataset, dataset_id)
    if dataset is None:
        raise RankSourceError(f"Dataset {dataset_id} not found")

    entries = session.query(RankDatasetEntry).filter_by(dataset_id=dataset_id).all()
    mappings = get_mappings(
        session, platform, RANK_CSV_SOURCE_TYPE, [e.normalized_name for e in entries]
    )

    ranks: dict[str, SourceRank] = {}
    unresolved: list[str] = []
    for entry in entries:
        mapping = mappings.get(entry.normalized_name)
        # A mapping to None is a confirmed "not a player" -- as unresolved for
        # our purposes as no mapping at all, but deliberately not re-asked.
        if mapping is None or mapping.platform_player_id is None:
            unresolved.append(entry.source_name_raw)
            continue
        ranks[mapping.platform_player_id] = SourceRank(
            overall_rank=entry.overall_rank,
            position_rank=entry.position_rank,
            tier=entry.tier,
        )

    return RankSource(
        ref=format_source_ref(DATASET, dataset_id),
        label=dataset.name,
        kind=DATASET,
        supports_overall=dataset.has_overall,
        supports_positional=dataset.has_positional,
        ranks=ranks,
        unresolved=unresolved,
        depth=_depths(ranks, _player_positions(session, platform)),
    )


def _load_rank_set(session: Session, rank_set_id: int, platform: str) -> RankSource:
    rank_set = session.get(RankSet, rank_set_id)
    if rank_set is None:
        raise RankSourceError(f"Rank set {rank_set_id} not found")

    entries = session.query(RankEntry).filter_by(rank_set_id=rank_set_id).all()
    is_overall = rank_set.scope == OVERALL
    ranks = {
        e.platform_player_id: SourceRank(
            overall_rank=e.rank if is_overall else None,
            position_rank=None if is_overall else e.rank,
            tier=e.tier,
        )
        for e in entries
    }

    return RankSource(
        ref=format_source_ref(RANK_SET, rank_set_id),
        label=rank_set.name,
        kind=RANK_SET,
        supports_overall=is_overall,
        supports_positional=not is_overall,
        ranks=ranks,
        depth=_depths(ranks, _player_positions(session, platform)),
    )


def load_rank_source(
    session: Session, ref: str, platform: str, season: str, format: str
) -> RankSource:
    kind, source_id = parse_source_ref(ref)
    if kind == ADP:
        return _load_adp(session, platform, season, format)
    if kind == DATASET:
        return _load_dataset(session, source_id, platform)
    return _load_rank_set(session, source_id, platform)


def load_rank_sources(
    session: Session, refs: list[str], platform: str, season: str, format: str, scope: str = OVERALL
) -> list[RankSource]:
    """Load several sources, rejecting any that can't serve the axis being built.

    Rejecting is deliberate. Returning a source with no usable ranks would show
    as "unranked" against every candidate, which reads as a broken import
    rather than "this file only has positional ranks".
    """
    sources = [load_rank_source(session, ref, platform, season, format) for ref in refs]

    wants_overall = scope == OVERALL
    for source in sources:
        if wants_overall and not source.supports_overall:
            raise RankSourceError(
                f"{source.label!r} has no overall ranks, so it can't feed an overall list"
            )
        if not wants_overall and not source.supports_positional:
            raise RankSourceError(
                f"{source.label!r} has no positional ranks, so it can't feed a {scope} list"
            )
    return sources


def list_available_sources(session: Session, platform: str, season: str, format: str) -> list[dict]:
    """Everything selectable in the builder, with what each can serve."""
    sources: list[dict] = [
        {
            "ref": ADP,
            "label": "ADP",
            "kind": ADP,
            "supports_overall": True,
            "supports_positional": True,
            "scope": None,
        }
    ]

    for dataset in (
        session.query(RankDataset)
        .filter_by(season=season, format=format)
        .order_by(RankDataset.id.asc())
        .all()
    ):
        sources.append(
            {
                "ref": format_source_ref(DATASET, dataset.id),
                "label": dataset.name,
                "kind": DATASET,
                "supports_overall": dataset.has_overall,
                "supports_positional": dataset.has_positional,
                "scope": None,
            }
        )

    for rank_set in (
        session.query(RankSet)
        .filter_by(platform=platform, season=season, format=format)
        .order_by(RankSet.id.asc())
        .all()
    ):
        is_overall = rank_set.scope == OVERALL
        sources.append(
            {
                "ref": format_source_ref(RANK_SET, rank_set.id),
                "label": rank_set.name,
                "kind": RANK_SET,
                "supports_overall": is_overall,
                "supports_positional": not is_overall,
                "scope": rank_set.scope,
            }
        )

    return sources


def build_rank_pool(
    session: Session,
    refs: list[str],
    platform: str,
    season: str,
    format: str,
    scope: str = OVERALL,
) -> dict:
    """The candidate pool: every player any selected source ranks, with what
    each source says about them.

    A player absent from a source gets None for that source -- never a
    substituted number. An imputed rank is indistinguishable from a real one
    three functions later, and the frontend needs to show "3 of 4 sources"
    honestly.
    """
    sources = load_rank_sources(session, refs, platform, season, format, scope)
    is_overall = scope == OVERALL

    player_ids: set[str] = set()
    for source in sources:
        for player_id, rank in source.ranks.items():
            value = rank.overall_rank if is_overall else rank.position_rank
            if value is not None:
                player_ids.add(player_id)

    players = (
        session.query(PlatformPlayer)
        .filter(
            PlatformPlayer.platform == platform,
            PlatformPlayer.platform_player_id.in_(player_ids),
        )
        .all()
        if player_ids
        else []
    )
    if not is_overall:
        players = [p for p in players if p.position == scope]

    adp_by_id = {
        row.platform_player_id: row.adp
        for row in session.query(AdpEntry)
        .filter_by(platform=platform, season=season, format=format)
        .all()
    }

    rows = []
    for player in players:
        ranks: dict[str, int | None] = {}
        tiers: list[int] = []
        for source in sources:
            rank = source.ranks.get(player.platform_player_id)
            if rank is None:
                ranks[source.ref] = None
                continue
            ranks[source.ref] = rank.overall_rank if is_overall else rank.position_rank
            if rank.tier is not None:
                tiers.append(rank.tier)

        rows.append(
            {
                "platform_player_id": player.platform_player_id,
                "name": player.name,
                "position": player.position,
                "team": player.team,
                "adp": adp_by_id.get(player.platform_player_id),
                "ranks": ranks,
                # The most common tier across sources that gave one -- a
                # reference point, not a decision.
                "source_tier": max(set(tiers), key=tiers.count) if tiers else None,
            }
        )

    rows.sort(key=lambda r: r["name"])
    return {
        "scope": scope,
        "sources": [
            {
                "ref": s.ref,
                "label": s.label,
                "kind": s.kind,
                "depth": s.depth.get("overall" if is_overall else scope),
                "unresolved_count": len(s.unresolved),
            }
            for s in sources
        ],
        "players": rows,
    }
