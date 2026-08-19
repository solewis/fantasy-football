from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models import AdpEntry, PlatformPlayer


def list_players(
    session: Session,
    platform: str,
    season: str,
    format: str,
    position: str | None = None,
    search: str | None = None,
) -> list[dict]:
    """Players with ADP for the given platform/season/format, sorted by ADP ascending.

    Only players with a real ADP entry for this exact format are included —
    there's little value showing a player with no draft-relevance signal in
    this view, and Sleeper's per-format sentinel filtering already happened
    at ingest time (see app/ingest/sleeper_adp.py).
    """
    query = (
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
    )

    if position:
        query = query.filter(PlatformPlayer.position == position)
    if search:
        query = query.filter(PlatformPlayer.name.ilike(f"%{search}%"))

    query = query.order_by(AdpEntry.adp.asc())

    return [
        {
            "platform_player_id": player.platform_player_id,
            "name": player.name,
            "position": player.position,
            "team": player.team,
            "adp": adp,
        }
        for player, adp in query.all()
    ]
