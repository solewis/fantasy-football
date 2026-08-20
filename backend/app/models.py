from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PlatformPlayer(Base):
    """A platform's own player list — canonical player identity within a league on that platform."""

    __tablename__ = "platform_players"
    __table_args__ = (
        UniqueConstraint("platform", "platform_player_id", name="uq_platform_player"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String, index=True)
    platform_player_id: Mapped[str] = mapped_column(String, index=True)
    name: Mapped[str] = mapped_column(String)
    position: Mapped[str | None] = mapped_column(String, nullable=True)
    team: Mapped[str | None] = mapped_column(String, nullable=True)


class NameMapping(Base):
    """A confirmed resolution of a free-text source name (Sheet rank, ADP row) to a platform player.

    Once confirmed, future imports skip straight to auto_matched/confirmed_no_match for
    this (platform, source_type, normalized_name) — only genuinely new names need review.
    """

    __tablename__ = "name_mappings"
    __table_args__ = (
        UniqueConstraint("platform", "source_type", "normalized_name", name="uq_name_mapping"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String, index=True)
    source_type: Mapped[str] = mapped_column(String)  # "sheet_rank" | "adp"
    source_name_raw: Mapped[str] = mapped_column(String)
    normalized_name: Mapped[str] = mapped_column(String, index=True)
    # None = confirmed as "no match" (e.g. a name that isn't a real fantasy-relevant player)
    platform_player_id: Mapped[str | None] = mapped_column(String, nullable=True)
    confirmed: Mapped[bool] = mapped_column(Boolean, default=True)


class AdpEntry(Base):
    """ADP for a platform player, in a given season and scoring format.

    Sourced from Sleeper's (undocumented) projections endpoint, which already
    keys ADP to Sleeper's own player_id — no name-matching needed for this one,
    unlike the Sheet-based ranks.
    """

    __tablename__ = "adp_entries"
    __table_args__ = (
        UniqueConstraint("platform", "platform_player_id", "season", "format", name="uq_adp_entry"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String, index=True)
    platform_player_id: Mapped[str] = mapped_column(String, index=True)
    season: Mapped[str] = mapped_column(String, index=True)
    format: Mapped[str] = mapped_column(String)  # e.g. "std", "ppr", "half_ppr", "dynasty_ppr"
    adp: Mapped[float] = mapped_column(Float)


class SyncStatus(Base):
    """When a given ingestion last ran, keyed by sync type (+ season, where applicable).

    One row per (sync_type, season) -- upserted on every sync, not an append-only
    log, since the UI only ever needs "when did this last run", not history.
    Record counts are deliberately NOT stored here; they're computed live from
    the actual tables (PlatformPlayer/AdpEntry) so this can never drift from
    what's really in the DB.
    """

    __tablename__ = "sync_status"
    __table_args__ = (UniqueConstraint("sync_type", "season", name="uq_sync_status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    sync_type: Mapped[str] = mapped_column(String, index=True)  # "sleeper_players" | "sleeper_adp"
    season: Mapped[str | None] = mapped_column(
        String, nullable=True
    )  # null for non-season-scoped syncs
    last_synced_at: Mapped[datetime] = mapped_column(DateTime)


class MyRank(Base):
    """Your personal rank order for a player, scoped like AdpEntry (platform/season/format)
    rather than to a League -- leagues aren't modeled yet, and a league's actual rank set
    is just whichever format matches its scoring settings. No tiers yet (v1 scope: an
    in-app drag-and-drop builder seeded from ADP); a Sheet-based import is a separate,
    still-deferred path onto the same table.
    """

    __tablename__ = "my_ranks"
    __table_args__ = (
        UniqueConstraint("platform", "season", "format", "platform_player_id", name="uq_my_rank"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String, index=True)
    season: Mapped[str] = mapped_column(String, index=True)
    format: Mapped[str] = mapped_column(String, index=True)
    platform_player_id: Mapped[str] = mapped_column(String, index=True)
    rank: Mapped[int] = mapped_column(Integer)


class Draft(Base):
    """A local, manually-tracked draft session -- not yet linked to a real platform draft
    (that's Phase 6, live Sleeper sync). `platform` is included now so a future sync can
    slot in `platform_draft_id` without reshaping this table.
    """

    __tablename__ = "drafts"

    id: Mapped[int] = mapped_column(primary_key=True)
    platform: Mapped[str] = mapped_column(String, default="manual")
    platform_draft_id: Mapped[str | None] = mapped_column(String, nullable=True)
    season: Mapped[str] = mapped_column(String, index=True)
    format: Mapped[str] = mapped_column(String, index=True)
    num_teams: Mapped[int] = mapped_column(Integer)
    num_rounds: Mapped[int] = mapped_column(Integer)
    my_slot: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime)


class DraftPick(Base):
    """One pick in a draft. `round`/`slot` (team column) are deliberately NOT stored --
    they're always derived from pick_number + the draft's num_teams via the snake-order
    math in app/draft_logic.py, so there's nothing to keep in sync.
    """

    __tablename__ = "draft_picks"
    __table_args__ = (
        UniqueConstraint("draft_id", "pick_number", name="uq_draft_pick_number"),
        UniqueConstraint("draft_id", "platform_player_id", name="uq_draft_pick_player"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("drafts.id"), index=True)
    pick_number: Mapped[int] = mapped_column(Integer)
    platform_player_id: Mapped[str] = mapped_column(String)


class DraftQueueEntry(Base):
    """Your personal draft-day shortlist, scoped to one draft (not global like MyRank) --
    a live queue is inherently tied to a specific board, and resets fresh per draft.
    """

    __tablename__ = "draft_queue_entries"
    __table_args__ = (
        UniqueConstraint("draft_id", "platform_player_id", name="uq_draft_queue_player"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    draft_id: Mapped[int] = mapped_column(ForeignKey("drafts.id"), index=True)
    platform_player_id: Mapped[str] = mapped_column(String)
    order: Mapped[int] = mapped_column(Integer)
