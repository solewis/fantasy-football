"""player exposures

Revision ID: 0008
Revises: 0007
Create Date: 2026-09-08 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0008"
down_revision: str | Sequence[str] | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "player_exposures",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("platform", sa.String(), nullable=False),
        sa.Column("season", sa.String(), nullable=False),
        sa.Column("platform_player_id", sa.String(), nullable=False),
        sa.Column("shares", sa.Integer(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("platform", "season", "platform_player_id", name="uq_player_exposure"),
    )
    with op.batch_alter_table("player_exposures", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_player_exposures_platform"), ["platform"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_player_exposures_season"), ["season"], unique=False)
        batch_op.create_index(
            batch_op.f("ix_player_exposures_platform_player_id"),
            ["platform_player_id"],
            unique=False,
        )


def downgrade() -> None:
    with op.batch_alter_table("player_exposures", schema=None) as batch_op:
        batch_op.drop_index(batch_op.f("ix_player_exposures_platform_player_id"))
        batch_op.drop_index(batch_op.f("ix_player_exposures_season"))
        batch_op.drop_index(batch_op.f("ix_player_exposures_platform"))

    op.drop_table("player_exposures")
