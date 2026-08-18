from sqlalchemy.orm import Session

from app.models import NameMapping


def get_mapping(
    session: Session, platform: str, source_type: str, normalized_name: str
) -> NameMapping | None:
    return (
        session.query(NameMapping)
        .filter_by(platform=platform, source_type=source_type, normalized_name=normalized_name)
        .one_or_none()
    )


def confirm_mapping(
    session: Session,
    platform: str,
    source_type: str,
    source_name_raw: str,
    normalized_name: str,
    platform_player_id: str | None,
) -> NameMapping:
    """Record a human's decision for a name — a real match, or a confirmed 'no match'."""
    existing = get_mapping(session, platform, source_type, normalized_name)
    if existing:
        existing.platform_player_id = platform_player_id
        existing.source_name_raw = source_name_raw
        existing.confirmed = True
    else:
        existing = NameMapping(
            platform=platform,
            source_type=source_type,
            source_name_raw=source_name_raw,
            normalized_name=normalized_name,
            platform_player_id=platform_player_id,
            confirmed=True,
        )
        session.add(existing)
    session.commit()
    return existing
