from datetime import UTC, datetime

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models import AdpEntry, PlatformPlayer, RankEntry, RankSet
from app.players import list_players

PLATFORM = "sleeper"


class RankSetError(ValueError):
    """A rank-set action that can't be satisfied (duplicate name, unknown set, ...)."""


def list_rank_sets(
    session: Session,
    platform: str = PLATFORM,
    season: str | None = None,
    format: str | None = None,
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

    query = query.group_by(RankSet.id).order_by(RankSet.id.asc())

    return [
        {
            "id": rank_set.id,
            "name": rank_set.name,
            "platform": rank_set.platform,
            "season": rank_set.season,
            "format": rank_set.format,
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
    seed_from_adp: bool = True,
) -> RankSet:
    name = name.strip()
    if not name:
        raise RankSetError("Rank set name can't be blank")

    existing = (
        session.query(RankSet)
        .filter_by(platform=platform, season=season, format=format, name=name)
        .one_or_none()
    )
    if existing:
        raise RankSetError(f"A rank set named {name!r} already exists for this format")

    rank_set = RankSet(
        name=name,
        platform=platform,
        season=season,
        format=format,
        created_at=datetime.now(UTC),
    )
    session.add(rank_set)
    session.commit()
    session.refresh(rank_set)

    if seed_from_adp:
        seed_rows = list_players(session, platform, season, format)
        replace_ranks(session, rank_set.id, [row["platform_player_id"] for row in seed_rows])

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
            platform=rank_set.platform, season=rank_set.season, format=rank_set.format, name=name
        )
        .filter(RankSet.id != rank_set_id)
        .one_or_none()
    )
    if existing:
        raise RankSetError(f"A rank set named {name!r} already exists for this format")

    rank_set.name = name
    session.commit()
    return rank_set


def delete_rank_set(session: Session, rank_set_id: int) -> None:
    rank_set = get_rank_set(session, rank_set_id)
    if rank_set is None:
        raise RankSetError("Rank set not found")

    # No PRAGMA foreign_keys=ON in this app -- entries have to be cleared explicitly.
    session.query(RankEntry).filter_by(rank_set_id=rank_set_id).delete()
    session.delete(rank_set)
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
        }
        for entry, player, adp in query.all()
    ]


def replace_ranks(session: Session, rank_set_id: int, platform_player_ids: list[str]) -> int:
    """Replace a rank set's entire saved order with the given list (index 0 = rank 1).
    Always a full replace, not an incremental edit -- a drag-and-drop rank builder
    only ever has one current, complete order.
    """
    session.query(RankEntry).filter_by(rank_set_id=rank_set_id).delete()
    for index, platform_player_id in enumerate(platform_player_ids):
        session.add(
            RankEntry(
                rank_set_id=rank_set_id,
                platform_player_id=platform_player_id,
                rank=index + 1,
            )
        )
    session.commit()
    return len(platform_player_ids)


def resolve_rank_set(session: Session, platform: str, season: str, format: str) -> RankSet | None:
    """TEMPORARY shim: the draft player pool asks "the ranks for half_ppr" without
    knowing about any specific rank set. Lowest id (first-created) wins for a
    format -- stable under later edits or new sets being created, unlike "most
    recently updated" would be. Deleted once a Draft carries a real rank_set_id
    via League (Phase C of the League-setup plan).
    """
    return (
        session.query(RankSet)
        .filter_by(platform=platform, season=season, format=format)
        .order_by(RankSet.id.asc())
        .first()
    )
