from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models import AdpEntry, League, PlatformPlayer, RankEntry, RankSet
from app.players import list_players

PLATFORM = "sleeper"

OVERALL = "overall"
# Positions that get their own buildable list. Deliberately narrower than
# lib/formats.ts's POSITIONS: ranking kickers and defenses carefully isn't worth
# the effort, and a FLEX list would overlap the individual ones -- that's what
# the overall list already is.
BUILD_POSITIONS = ("QB", "RB", "WR", "TE")
SCOPES = (OVERALL, *BUILD_POSITIONS)

# How hard the drop-off is after a player. Both weights start a new tier; they
# differ only in how sharp the cliff is, which is the thing you actually want
# to see on the clock.
BREAK_STRENGTHS = ("major", "minor")
# A personal lean that rank order can't express on its own.
FLAGS = ("target", "fade")


class RankSetError(ValueError):
    """A rank-set action that can't be satisfied (duplicate name, unknown set, ...)."""


@dataclass(frozen=True)
class RankEntryInput:
    """One row of a saved order. Carries the tier alongside the player so a
    save is a single full replace, matching how the editor actually works --
    it always has one complete, current order in hand.
    """

    platform_player_id: str
    tier: int | None = None
    break_after: str | None = None
    flag: str | None = None


def list_rank_sets(
    session: Session,
    platform: str = PLATFORM,
    season: str | None = None,
    format: str | None = None,
    scope: str | None = None,
) -> list[dict]:
    """Rank sets matching the given scope, with a live player count for each
    (a label like "Half PPR Main (312)" is more useful than a bare name).
    """
    query = (
        session.query(RankSet, func.count(RankEntry.id))
        .outerjoin(RankEntry, RankEntry.rank_set_id == RankSet.id)
        .filter(RankSet.platform == platform)
    )
    if season is not None:
        query = query.filter(RankSet.season == season)
    if format is not None:
        query = query.filter(RankSet.format == format)
    if scope is not None:
        query = query.filter(RankSet.scope == scope)

    query = query.group_by(RankSet.id).order_by(RankSet.id.asc())

    return [
        {
            "id": rank_set.id,
            "name": rank_set.name,
            "platform": rank_set.platform,
            "season": rank_set.season,
            "format": rank_set.format,
            "scope": rank_set.scope,
            "is_active": rank_set.is_active,
            "player_count": count,
        }
        for rank_set, count in query.all()
    ]


def get_rank_set(session: Session, rank_set_id: int) -> RankSet | None:
    return session.get(RankSet, rank_set_id)


def create_rank_set(
    session: Session,
    name: str,
    season: str,
    format: str,
    platform: str = PLATFORM,
    scope: str = OVERALL,
    seed_from_adp: bool = True,
) -> RankSet:
    name = name.strip()
    if not name:
        raise RankSetError("Rank set name can't be blank")
    if scope not in SCOPES:
        raise RankSetError(f"Unknown rank set scope {scope!r}")

    existing = (
        session.query(RankSet)
        .filter_by(platform=platform, season=season, format=format, scope=scope, name=name)
        .one_or_none()
    )
    if existing:
        raise RankSetError(f"A rank set named {name!r} already exists for this format")

    # A scope's first-ever list is unambiguous, so it becomes active with no
    # extra step -- including overall: an ad-hoc draft (no League to assign a
    # rank_set_id from) has no way to pick one otherwise, so it falls back to
    # whichever overall set is active. Once a scope already has one, a new
    # list is created inactive -- it's a fresh working copy, not an automatic
    # replacement of whatever's currently feeding the draft room.
    is_active = not (
        session.query(RankSet)
        .filter_by(platform=platform, season=season, format=format, scope=scope)
        .first()
    )

    rank_set = RankSet(
        name=name,
        platform=platform,
        season=season,
        format=format,
        scope=scope,
        is_active=is_active,
        created_at=datetime.now(UTC),
    )
    session.add(rank_set)
    session.commit()
    session.refresh(rank_set)

    if seed_from_adp:
        # A positional set seeds with just that position -- seeding a WR list
        # with every player would make the first job deleting 700 rows.
        position = None if scope == OVERALL else scope
        seed_rows = list_players(session, platform, season, format, position=position)
        replace_ranks(
            session,
            rank_set.id,
            [RankEntryInput(platform_player_id=row["platform_player_id"]) for row in seed_rows],
        )

    return rank_set


def rename_rank_set(session: Session, rank_set_id: int, name: str) -> RankSet:
    rank_set = get_rank_set(session, rank_set_id)
    if rank_set is None:
        raise RankSetError("Rank set not found")

    name = name.strip()
    if not name:
        raise RankSetError("Rank set name can't be blank")

    existing = (
        session.query(RankSet)
        .filter_by(
            platform=rank_set.platform,
            season=rank_set.season,
            format=rank_set.format,
            scope=rank_set.scope,
            name=name,
        )
        .filter(RankSet.id != rank_set_id)
        .one_or_none()
    )
    if existing:
        raise RankSetError(f"A rank set named {name!r} already exists for this format")

    rank_set.name = name
    session.commit()
    return rank_set


def set_active_rank_set(session: Session, rank_set_id: int) -> RankSet:
    """Mark a rank set as the one used automatically for its scope --
    a positional scope's active set feeds the overall builder's "next up"
    panel and the draft room's position tab; an overall scope's active set
    feeds the draft room's ALL tab for any draft with no League to assign a
    rank_set_id from (see resolve_rank_set). Deactivates whichever set
    previously held that spot for the same scope.
    """
    rank_set = get_rank_set(session, rank_set_id)
    if rank_set is None:
        raise RankSetError("Rank set not found")

    session.query(RankSet).filter_by(
        platform=rank_set.platform,
        season=rank_set.season,
        format=rank_set.format,
        scope=rank_set.scope,
    ).update({"is_active": False})
    rank_set.is_active = True
    session.commit()
    session.refresh(rank_set)
    return rank_set


def delete_rank_set(session: Session, rank_set_id: int) -> None:
    rank_set = get_rank_set(session, rank_set_id)
    if rank_set is None:
        raise RankSetError("Rank set not found")

    # Deleting the active set for a scope would otherwise leave it with zero
    # active sets even though others still exist -- promote the lowest
    # remaining id (same "first created wins" rule used elsewhere) so the
    # builder and draft room always have exactly one to fall back on.
    promoted = None
    if rank_set.is_active:
        promoted = (
            session.query(RankSet)
            .filter_by(
                platform=rank_set.platform,
                season=rank_set.season,
                format=rank_set.format,
                scope=rank_set.scope,
            )
            .filter(RankSet.id != rank_set_id)
            .order_by(RankSet.id.asc())
            .first()
        )

    # No PRAGMA foreign_keys=ON in this app -- entries (and any League still
    # pointing at this set) have to be cleared explicitly, not left dangling.
    session.query(RankEntry).filter_by(rank_set_id=rank_set_id).delete()
    session.query(League).filter_by(rank_set_id=rank_set_id).update({"rank_set_id": None})
    session.delete(rank_set)
    if promoted is not None:
        promoted.is_active = True
    session.commit()


def list_ranks(session: Session, rank_set_id: int) -> list[dict]:
    """A rank set's saved order, joined with player info and (if available) current
    ADP for reference while editing.
    """
    rank_set = get_rank_set(session, rank_set_id)
    if rank_set is None:
        return []

    query = (
        session.query(RankEntry, PlatformPlayer, AdpEntry.adp)
        .join(
            PlatformPlayer,
            and_(
                PlatformPlayer.platform == rank_set.platform,
                PlatformPlayer.platform_player_id == RankEntry.platform_player_id,
            ),
        )
        .outerjoin(
            AdpEntry,
            and_(
                AdpEntry.platform == rank_set.platform,
                AdpEntry.platform_player_id == RankEntry.platform_player_id,
                AdpEntry.season == rank_set.season,
                AdpEntry.format == rank_set.format,
            ),
        )
        .filter(RankEntry.rank_set_id == rank_set_id)
        .order_by(RankEntry.rank.asc())
    )

    return [
        {
            "rank": entry.rank,
            "platform_player_id": player.platform_player_id,
            "name": player.name,
            "position": player.position,
            "team": player.team,
            "adp": adp,
            "tier": entry.tier,
            "break_after": entry.break_after,
            "flag": entry.flag,
        }
        for entry, player, adp in query.all()
    ]


def replace_ranks(session: Session, rank_set_id: int, entries: list[RankEntryInput]) -> int:
    """Replace a rank set's entire saved order with the given list (index 0 = rank 1).
    Always a full replace, not an incremental edit -- a drag-and-drop rank builder
    only ever has one current, complete order.

    Tiers ride along on each entry rather than being saved separately: they're a
    grouping over this exact order, so saving them apart from it would let the
    two drift.
    """
    for entry in entries:
        if entry.break_after is not None and entry.break_after not in BREAK_STRENGTHS:
            raise RankSetError(f"Unknown tier break strength {entry.break_after!r}")
        if entry.flag is not None and entry.flag not in FLAGS:
            raise RankSetError(f"Unknown flag {entry.flag!r}")

    session.query(RankEntry).filter_by(rank_set_id=rank_set_id).delete()
    for index, entry in enumerate(entries):
        session.add(
            RankEntry(
                rank_set_id=rank_set_id,
                platform_player_id=entry.platform_player_id,
                rank=index + 1,
                tier=entry.tier,
                break_after=entry.break_after,
                flag=entry.flag,
            )
        )
    session.commit()
    return len(entries)


def resolve_rank_set(session: Session, platform: str, season: str, format: str) -> RankSet | None:
    """The draft player pool asks "the ranks for half_ppr" for any draft with
    no League (and so no explicit rank_set_id) to ask instead -- an ad-hoc
    draft, or a League that's never had one assigned. The active overall set
    wins, so a user with more than one overall list (e.g. a "real" one and a
    draft-night experiment) can actually choose which one an ad-hoc draft
    uses, the same way set_active_rank_set already lets them choose a
    position's list. Falls back to lowest id (first-created) when nothing
    happens to be marked active, which only occurs for data that predates the
    active flag -- never leaves a working single-overall-set setup stranded.

    Restricted to overall sets on purpose. Without that filter a positional set
    with a lower id would win here and the draft pool would quietly show only
    receivers -- no error, just a wrong board, which is about the worst way for
    this to fail.
    """
    query = session.query(RankSet).filter_by(
        platform=platform, season=season, format=format, scope=OVERALL
    )
    active = query.filter_by(is_active=True).order_by(RankSet.id.asc()).first()
    if active is not None:
        return active
    return query.order_by(RankSet.id.asc()).first()
