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


def get_mappings(
    session: Session, platform: str, source_type: str, normalized_names: list[str]
) -> dict[str, NameMapping]:
    """Every mapping for a batch of names, in one query.

    The per-name get_mapping() above turns a 400-row import into 400 SELECTs,
    and the read path would re-pay that on every builder refresh.
    """
    if not normalized_names:
        return {}
    rows = (
        session.query(NameMapping)
        .filter(
            NameMapping.platform == platform,
            NameMapping.source_type == source_type,
            NameMapping.normalized_name.in_(set(normalized_names)),
        )
        .all()
    )
    return {row.normalized_name: row for row in rows}


def confirm_mapping(
    session: Session,
    platform: str,
    source_type: str,
    source_name_raw: str,
    normalized_name: str,
    platform_player_id: str | None,
    commit: bool = True,
) -> NameMapping:
    """Record a human's decision for a name — a real match, or a confirmed 'no match'.

    commit=False lets a bulk confirm run as one transaction; committing per row
    means a failure halfway through leaves the batch half-applied.
    """
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
    if commit:
        session.commit()
    else:
        session.flush()
    return existing
