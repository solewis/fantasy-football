from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models import AdpEntry, MyRank, PlatformPlayer


def list_my_ranks(session: Session, platform: str, season: str, format: str) -> list[dict]:
    """Your saved rank order for a platform/season/format, joined with player info
    and (if available) current ADP for reference while editing. Empty if nothing has
    been saved yet for this scope -- the frontend falls back to ADP order in that case.
    """
    query = (
        session.query(MyRank, PlatformPlayer, AdpEntry.adp)
        .join(
            PlatformPlayer,
            and_(
                PlatformPlayer.platform == MyRank.platform,
                PlatformPlayer.platform_player_id == MyRank.platform_player_id,
            ),
        )
        .outerjoin(
            AdpEntry,
            and_(
                AdpEntry.platform == MyRank.platform,
                AdpEntry.platform_player_id == MyRank.platform_player_id,
                AdpEntry.season == MyRank.season,
                AdpEntry.format == MyRank.format,
            ),
        )
        .filter(MyRank.platform == platform, MyRank.season == season, MyRank.format == format)
        .order_by(MyRank.rank.asc())
    )

    return [
        {
            "rank": rank_row.rank,
            "platform_player_id": player.platform_player_id,
            "name": player.name,
            "position": player.position,
            "team": player.team,
            "adp": adp,
        }
        for rank_row, player, adp in query.all()
    ]


def replace_my_ranks(
    session: Session, platform: str, season: str, format: str, platform_player_ids: list[str]
) -> int:
    """Replace the entire saved rank order for this scope with the given list
    (index 0 = rank 1). Always a full replace, not an incremental edit -- a
    drag-and-drop rank builder only ever has one current, complete order.
    """
    session.query(MyRank).filter_by(platform=platform, season=season, format=format).delete()
    for index, platform_player_id in enumerate(platform_player_ids):
        session.add(
            MyRank(
                platform=platform,
                season=season,
                format=format,
                platform_player_id=platform_player_id,
                rank=index + 1,
            )
        )
    session.commit()
    return len(platform_player_ids)
