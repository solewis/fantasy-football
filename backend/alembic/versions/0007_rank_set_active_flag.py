"""rank set active flag

Revision ID: 0007
Revises: 0006
Create Date: 2026-09-03 00:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0007"
down_revision: str | Sequence[str] | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("rank_sets", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("is_active", sa.Boolean(), nullable=False, server_default="0")
        )

    # Backfill: exactly one active set per (platform, season, format, scope)
    # group, picking the lowest id -- the same "first created wins" rule
    # resolve_rank_set already uses elsewhere in this file's history, so a
    # user with only one existing list per position gets it marked active
    # automatically, with no manual step.
    op.execute(
        """
        UPDATE rank_sets SET is_active = 1
        WHERE id IN (
            SELECT MIN(id) FROM rank_sets GROUP BY platform, season, format, scope
        )
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("rank_sets", schema=None) as batch_op:
        batch_op.drop_column("is_active")
