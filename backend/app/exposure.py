from datetime import UTC, datetime

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.models import PlatformPlayer, PlayerExposure

PLATFORM = "sleeper"


class ExposureError(ValueError):
    """An exposure action that can't be satisfied (unknown player, bad share count, ...)."""


def list_exposures(
    session: Session, platform: str = PLATFORM, season: str | None = None
) -> list[dict]:
    """Every player you've recorded a share count for, joined with identity
    (name/position/team) so the page never has to show a bare id. Sorted by
    shares descending -- the players you're most exposed to are what you'd
    actually want to see first.
    """
    query = (
        session.query(PlayerExposure, PlatformPlayer)
        .join(
            PlatformPlayer,
            and_(
                PlatformPlayer.platform == PlayerExposure.platform,
                PlatformPlayer.platform_player_id == PlayerExposure.platform_player_id,
            ),
        )
        .filter(PlayerExposure.platform == platform)
    )
    if season is not None:
        query = query.filter(PlayerExposure.season == season)

    query = query.order_by(PlayerExposure.shares.desc(), PlatformPlayer.name.asc())

    return [
        {
            "id": exposure.id,
            "platform": exposure.platform,
            "season": exposure.season,
            "platform_player_id": exposure.platform_player_id,
            "name": player.name,
            "position": player.position,
            "team": player.team,
            "shares": exposure.shares,
            "updated_at": exposure.updated_at,
        }
        for exposure, player in query.all()
    ]


def set_exposure(
    session: Session,
    platform: str,
    season: str,
    platform_player_id: str,
    shares: int,
) -> dict:
    """Create or update your share count for a player -- a plain replace, not
    an increment, so re-submitting the same form twice is harmless.
    """
    if shares < 1:
        raise ExposureError("Shares must be at least 1 -- use delete to remove a player")

    player = (
        session.query(PlatformPlayer)
        .filter_by(platform=platform, platform_player_id=platform_player_id)
        .one_or_none()
    )
    if player is None:
        raise ExposureError(f"No {platform} player found for id {platform_player_id!r}")

    exposure = (
        session.query(PlayerExposure)
        .filter_by(platform=platform, season=season, platform_player_id=platform_player_id)
        .one_or_none()
    )
    now = datetime.now(UTC)
    if exposure is None:
        exposure = PlayerExposure(
            platform=platform,
            season=season,
            platform_player_id=platform_player_id,
            shares=shares,
            updated_at=now,
        )
        session.add(exposure)
    else:
        exposure.shares = shares
        exposure.updated_at = now

    session.commit()
    session.refresh(exposure)
    return {
        "id": exposure.id,
        "platform": exposure.platform,
        "season": exposure.season,
        "platform_player_id": exposure.platform_player_id,
        "name": player.name,
        "position": player.position,
        "team": player.team,
        "shares": exposure.shares,
        "updated_at": exposure.updated_at,
    }


def delete_exposure(session: Session, exposure_id: int) -> None:
    exposure = session.get(PlayerExposure, exposure_id)
    if exposure is None:
        raise ExposureError("Exposure not found")
    session.delete(exposure)
    session.commit()
