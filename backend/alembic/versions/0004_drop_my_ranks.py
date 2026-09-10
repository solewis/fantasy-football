"""drop my_ranks

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-26 11:30:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0004"
down_revision: str | Sequence[str] | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Drop the dead my_ranks table.

    my_ranks is the pre-RankSet flat rank store, replaced by rank_sets +
    rank_entries. It has not been in models.py since that change, but the rows
    were never dropped, so the live database still carries ~781 of them.

    Kept out of the baseline deliberately, in its own revision: 0001 stays a
    pure "build the schema from models.py" revision that a fresh clone can run,
    and dropping real (if obsolete) rows stays an explicit, reviewable step
    rather than a side effect buried in a table-creation migration.

    checkfirst is needed because a database built from 0001 onward never had
    this table at all -- only the long-lived local one does.
    """
    bind = op.get_bind()
    if sa.inspect(bind).has_table("my_ranks"):
        op.drop_table("my_ranks")


def downgrade() -> None:
    """Recreates the table empty. The rows are not recoverable from here -- by
    the time this revision runs they have been superseded by rank_entries for
    well over a year of this project's history.
    """
    op.create_table(
        "my_ranks",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("platform", sa.String(), nullable=False),
        sa.Column("season", sa.String(), nullable=False),
        sa.Column("format", sa.String(), nullable=False),
        sa.Column("platform_player_id", sa.String(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "platform", "season", "format", "platform_player_id", name="uq_my_rank"
        ),
    )
    op.create_index("ix_my_ranks_format", "my_ranks", ["format"], unique=False)
    op.create_index("ix_my_ranks_platform", "my_ranks", ["platform"], unique=False)
    op.create_index(
        "ix_my_ranks_platform_player_id", "my_ranks", ["platform_player_id"], unique=False
    )
    op.create_index("ix_my_ranks_season", "my_ranks", ["season"], unique=False)
