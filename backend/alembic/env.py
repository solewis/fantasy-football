from logging.config import fileConfig

from alembic import context

# Importing models for their side effect: every model class has to be imported
# before Base.metadata is complete, or autogenerate silently sees an empty
# schema and writes a migration that drops every table.
from app import models  # noqa: F401
from app.db import Base, engine

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=str(engine.url),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        # SQLite can't ALTER a constraint or drop a column in place, so any
        # such change has to go through Alembic's batch mode, which rebuilds
        # the table and copies the rows. Set here rather than per-migration so
        # nobody has to remember it -- forgetting produces a migration that
        # runs fine on Postgres and blows up on the only database we use.
        render_as_batch=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    # Reuses app.db's engine rather than alembic.ini's sqlalchemy.url so the
    # database location has exactly one definition (app/db.py) and can't drift.
    with engine.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            render_as_batch=True,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
