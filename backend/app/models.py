from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, String, UniqueConstraint
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
