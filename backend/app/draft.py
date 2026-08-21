from datetime import UTC, datetime

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.draft_logic import pick_to_round_and_slot, total_picks
from app.ingest import sleeper_draft, sleeper_league
from app.models import Draft, DraftPick, DraftQueueEntry, League, PlatformPlayer

PLATFORM = "sleeper"


def _team_names_by_slot(
    slot_to_roster_id: dict[str, int], league_team_names: dict[str, str]
) -> dict[str, str]:
    """Cross-reference a draft's own slot_to_roster_id (board-column -> roster)
    against a League's team_names (roster -> name) -- draft-slot assignment
    isn't known at the League level, only once a specific Sleeper draft has
    randomized its order.
    """
    return {
        slot: league_team_names[str(roster_id)]
        for slot, roster_id in slot_to_roster_id.items()
        if str(roster_id) in league_team_names
    }


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


def create_sleeper_draft(
    session: Session,
    platform_draft_id: str,
    format: str,
    my_slot: int,
) -> Draft:
    try:
        raw = sleeper_draft.fetch_raw_draft(platform_draft_id)
        meta = sleeper_draft.parse_draft_meta(raw)
    except sleeper_draft.SleeperFetchError as exc:
        raise DraftError(str(exc)) from exc

    draft = Draft(
        platform=PLATFORM,
        platform_draft_id=platform_draft_id,
        season=meta["season"],
        format=format,
        num_teams=meta["num_teams"],
        num_rounds=meta["num_rounds"],
        my_slot=my_slot,
        created_at=datetime.now(UTC),
    )
    session.add(draft)
    session.commit()
    session.refresh(draft)
    return draft


def create_draft_from_league(session: Session, league_id: int, my_slot: int) -> Draft:
    """Create a draft from a saved League: looks up the league's current Sleeper
    draft (its own `draft_id` field -- the draft the league is presently set up
    for, not a full history of past-season drafts) rather than pasting a raw
    draft ID, and inherits the league's format/roster shape instead of asking
    for it again.
    """
    league = session.get(League, league_id)
    if league is None:
        raise DraftError("League not found")
    if not (1 <= my_slot <= league.num_teams):
        raise DraftError(f"Slot must be between 1 and {league.num_teams}")

    try:
        raw_league = sleeper_league.fetch_raw_league(league.platform_league_id)
    except sleeper_league.SleeperFetchError as exc:
        raise DraftError(str(exc)) from exc

    platform_draft_id = raw_league.get("draft_id")
    if not platform_draft_id:
        raise DraftError("This league doesn't have an active draft yet")

    try:
        raw_draft = sleeper_draft.fetch_raw_draft(platform_draft_id)
        meta = sleeper_draft.parse_draft_meta(raw_draft)
    except sleeper_draft.SleeperFetchError as exc:
        raise DraftError(str(exc)) from exc

    draft = Draft(
        platform=PLATFORM,
        platform_draft_id=platform_draft_id,
        league_id=league.id,
        season=meta["season"],
        format=league.format,
        num_teams=meta["num_teams"],
        num_rounds=meta["num_rounds"],
        my_slot=my_slot,
        team_names=_team_names_by_slot(meta["slot_to_roster_id"], league.team_names) or None,
        created_at=datetime.now(UTC),
    )
    session.add(draft)
    session.commit()
    session.refresh(draft)
    return draft


def sync_sleeper_draft(session: Session, draft_id: int) -> dict:
    draft = get_draft(session, draft_id)
    if draft is None:
        raise DraftError("Draft not found")
    if draft.platform != PLATFORM or not draft.platform_draft_id:
        raise DraftError("Draft is not linked to a Sleeper draft")

    try:
        raw_picks = sleeper_draft.fetch_raw_picks(draft.platform_draft_id)
    except sleeper_draft.SleeperFetchError as exc:
        raise DraftError(str(exc)) from exc

    # Sleeper only assigns slot_to_roster_id once the draft's order is set --
    # that can happen after the draft was first created here, so re-check it
    # on every sync rather than only at creation time.
    if draft.league_id is not None:
        league = session.get(League, draft.league_id)
        if league is not None:
            try:
                raw_draft = sleeper_draft.fetch_raw_draft(draft.platform_draft_id)
                meta = sleeper_draft.parse_draft_meta(raw_draft)
            except sleeper_draft.SleeperFetchError as exc:
                raise DraftError(str(exc)) from exc
            draft.team_names = (
                _team_names_by_slot(meta["slot_to_roster_id"], league.team_names) or None
            )

    parsed = sleeper_draft.parse_picks(raw_picks)
    existing_numbers = {
        row.pick_number
        for row in session.query(DraftPick.pick_number).filter_by(draft_id=draft_id).all()
    }

    new_player_ids = []
    for entry in parsed:
        if entry["pick_number"] in existing_numbers:
            continue
        session.add(
            DraftPick(
                draft_id=draft_id,
                pick_number=entry["pick_number"],
                platform_player_id=entry["platform_player_id"],
            )
        )
        new_player_ids.append(entry["platform_player_id"])

    if new_player_ids:
        session.query(DraftQueueEntry).filter(
            DraftQueueEntry.draft_id == draft_id,
            DraftQueueEntry.platform_player_id.in_(new_player_ids),
        ).delete(synchronize_session=False)

    session.commit()
    return get_status(session, draft_id)


def switch_to_manual(session: Session, draft_id: int) -> dict:
    draft = get_draft(session, draft_id)
    if draft is None:
        raise DraftError("Draft not found")

    draft.platform = "manual"
    session.commit()
    return get_status(session, draft_id)


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
    if draft.platform == PLATFORM:
        raise DraftError("This draft is synced live from Sleeper; picks can't be entered manually")

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
    draft = get_draft(session, draft_id)
    if draft is not None and draft.platform == PLATFORM:
        raise DraftError("This draft is synced live from Sleeper; picks can't be undone manually")

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

    # rank_set_id/roster_positions are read live from the League, not stored on
    # Draft itself -- if you change a league's rank set or roster shape later,
    # drafts created from it should reflect that automatically, not go stale.
    league = session.get(League, draft.league_id) if draft.league_id else None

    return {
        "draft": {
            "id": draft.id,
            "platform": draft.platform,
            "platform_draft_id": draft.platform_draft_id,
            "league_id": draft.league_id,
            "season": draft.season,
            "format": draft.format,
            "num_teams": draft.num_teams,
            "num_rounds": draft.num_rounds,
            "my_slot": draft.my_slot,
            "rank_set_id": league.rank_set_id if league else None,
            "roster_positions": league.roster_positions if league else None,
            "team_names": draft.team_names or {},
        },
        "picks": picks,
        "next_pick_number": None if is_complete else next_pick_number,
        "current_round": current_round,
        "current_slot": current_slot,
        "is_my_turn": (not is_complete) and current_slot == draft.my_slot,
        "is_complete": is_complete,
    }


def list_drafts(session: Session, league_id: int | None = None) -> list[dict]:
    """Lightweight draft summaries for the Leagues UI -- deliberately not a full
    get_status() per row (that would N+1 into a League lookup per draft, and
    the Leagues list only needs "is there a draft, and how far along is it").
    One grouped query for pick counts, no N+1. Ordered newest-first by id (the
    monotonic authority -- created_at can tie within the same second).
    """
    query = (
        session.query(Draft, func.count(DraftPick.id))
        .outerjoin(DraftPick, DraftPick.draft_id == Draft.id)
        .group_by(Draft.id)
        .order_by(Draft.id.desc())
    )
    if league_id is not None:
        query = query.filter(Draft.league_id == league_id)

    results = []
    for draft, pick_count in query.all():
        max_picks = total_picks(draft.num_teams, draft.num_rounds)
        next_pick_number = pick_count + 1
        is_complete = next_pick_number > max_picks
        current_round = None
        if not is_complete:
            current_round, _ = pick_to_round_and_slot(next_pick_number, draft.num_teams)
        results.append(
            {
                "id": draft.id,
                "platform": draft.platform,
                "league_id": draft.league_id,
                "season": draft.season,
                "format": draft.format,
                "num_teams": draft.num_teams,
                "num_rounds": draft.num_rounds,
                "my_slot": draft.my_slot,
                "pick_count": pick_count,
                "next_pick_number": None if is_complete else next_pick_number,
                "current_round": current_round,
                "is_complete": is_complete,
                "created_at": draft.created_at,
            }
        )
    return results


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
