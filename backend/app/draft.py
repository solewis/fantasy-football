from datetime import UTC, datetime

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.draft_logic import pick_to_round_and_slot, total_picks
from app.models import Draft, DraftPick, DraftQueueEntry, PlatformPlayer

PLATFORM = "sleeper"


class DraftError(ValueError):
    """A pick/queue action that violates draft rules (already picked, draft complete, ...)."""


def create_draft(
    session: Session,
    season: str,
    format: str,
    num_teams: int,
    num_rounds: int,
    my_slot: int,
) -> Draft:
    draft = Draft(
        platform="manual",
        season=season,
        format=format,
        num_teams=num_teams,
        num_rounds=num_rounds,
        my_slot=my_slot,
        created_at=datetime.now(UTC),
    )
    session.add(draft)
    session.commit()
    session.refresh(draft)
    return draft


def get_draft(session: Session, draft_id: int) -> Draft | None:
    return session.get(Draft, draft_id)


def list_picks(session: Session, draft_id: int) -> list[dict]:
    draft = get_draft(session, draft_id)
    if draft is None:
        return []

    query = (
        session.query(DraftPick, PlatformPlayer)
        .join(
            PlatformPlayer,
            and_(
                PlatformPlayer.platform == PLATFORM,
                PlatformPlayer.platform_player_id == DraftPick.platform_player_id,
            ),
        )
        .filter(DraftPick.draft_id == draft_id)
        .order_by(DraftPick.pick_number.asc())
    )

    results = []
    for pick, player in query.all():
        round_, slot = pick_to_round_and_slot(pick.pick_number, draft.num_teams)
        results.append(
            {
                "pick_number": pick.pick_number,
                "round": round_,
                "slot": slot,
                "platform_player_id": player.platform_player_id,
                "name": player.name,
                "position": player.position,
                "team": player.team,
            }
        )
    return results


def make_pick(session: Session, draft_id: int, platform_player_id: str) -> dict:
    draft = get_draft(session, draft_id)
    if draft is None:
        raise DraftError("Draft not found")

    existing_count = session.query(DraftPick).filter_by(draft_id=draft_id).count()
    if existing_count >= total_picks(draft.num_teams, draft.num_rounds):
        raise DraftError("Draft is already complete")

    already_picked = (
        session.query(DraftPick)
        .filter_by(draft_id=draft_id, platform_player_id=platform_player_id)
        .one_or_none()
    )
    if already_picked:
        raise DraftError("Player already picked in this draft")

    pick_number = existing_count + 1
    session.add(
        DraftPick(draft_id=draft_id, pick_number=pick_number, platform_player_id=platform_player_id)
    )

    # A drafted player no longer belongs in the queue.
    session.query(DraftQueueEntry).filter_by(
        draft_id=draft_id, platform_player_id=platform_player_id
    ).delete()

    session.commit()
    return {"pick_number": pick_number}


def undo_last_pick(session: Session, draft_id: int) -> dict | None:
    last = (
        session.query(DraftPick)
        .filter_by(draft_id=draft_id)
        .order_by(DraftPick.pick_number.desc())
        .first()
    )
    if last is None:
        return None

    undone = {"pick_number": last.pick_number, "platform_player_id": last.platform_player_id}
    session.delete(last)
    session.commit()
    return undone


def get_status(session: Session, draft_id: int) -> dict | None:
    draft = get_draft(session, draft_id)
    if draft is None:
        return None

    picks = list_picks(session, draft_id)
    max_picks = total_picks(draft.num_teams, draft.num_rounds)
    next_pick_number = len(picks) + 1
    is_complete = next_pick_number > max_picks

    current_round = current_slot = None
    if not is_complete:
        current_round, current_slot = pick_to_round_and_slot(next_pick_number, draft.num_teams)

    return {
        "draft": {
            "id": draft.id,
            "season": draft.season,
            "format": draft.format,
            "num_teams": draft.num_teams,
            "num_rounds": draft.num_rounds,
            "my_slot": draft.my_slot,
        },
        "picks": picks,
        "next_pick_number": None if is_complete else next_pick_number,
        "current_round": current_round,
        "current_slot": current_slot,
        "is_my_turn": (not is_complete) and current_slot == draft.my_slot,
        "is_complete": is_complete,
    }


def list_queue(session: Session, draft_id: int) -> list[dict]:
    query = (
        session.query(DraftQueueEntry, PlatformPlayer)
        .join(
            PlatformPlayer,
            and_(
                PlatformPlayer.platform == PLATFORM,
                PlatformPlayer.platform_player_id == DraftQueueEntry.platform_player_id,
            ),
        )
        .filter(DraftQueueEntry.draft_id == draft_id)
        .order_by(DraftQueueEntry.order.asc())
    )
    return [
        {
            "platform_player_id": entry.platform_player_id,
            "name": player.name,
            "position": player.position,
            "team": player.team,
        }
        for entry, player in query.all()
    ]


def replace_queue(session: Session, draft_id: int, platform_player_ids: list[str]) -> int:
    session.query(DraftQueueEntry).filter_by(draft_id=draft_id).delete()
    for index, platform_player_id in enumerate(platform_player_ids):
        session.add(
            DraftQueueEntry(
                draft_id=draft_id, platform_player_id=platform_player_id, order=index + 1
            )
        )
    session.commit()
    return len(platform_player_ids)
