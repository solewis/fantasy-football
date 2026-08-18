from sqlalchemy import String, UniqueConstraint
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
