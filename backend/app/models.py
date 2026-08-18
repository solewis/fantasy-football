from sqlalchemy import Boolean, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class PlatformPlayer(Base):
    """A platform's own player list — canonical player identity within a league on that platform."""

    __tablename__ = "platform_players"
    __table_args__ = (UniqueConstraint("platform", "platform_player_id", name="uq_platform_player"),)

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
