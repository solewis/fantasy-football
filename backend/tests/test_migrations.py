"""Migrations have to survive a full round trip.

This is the only test that runs Alembic at all -- every other test builds its
schema straight from Base.metadata.create_all(), which is fast but means a
broken migration would otherwise sail through the whole suite and only fail
against the real database. It matters most for SQLite batch operations
(constraint and column changes), which rewrite the table rather than altering
it and are easy to get subtly wrong.

Each subprocess gets its own throwaway database via FANTASY_DB_URL, since
app/db.py builds its engine at import time.
"""

import os
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent.parent


def run_alembic(*args: str, db_path: Path) -> subprocess.CompletedProcess:
    env = {**os.environ, "FANTASY_DB_URL": f"sqlite:///{db_path}"}
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_upgrade_head_then_downgrade_base(tmp_path):
    db_path = tmp_path / "roundtrip.db"

    up = run_alembic("upgrade", "head", db_path=db_path)
    assert up.returncode == 0, up.stderr

    down = run_alembic("downgrade", "base", db_path=db_path)
    assert down.returncode == 0, down.stderr


def test_models_match_migrations(tmp_path):
    """`alembic check` fails when models.py has changes no revision covers --
    the guard against the schema and the migrations silently drifting apart,
    which create_all()-based tests cannot catch.
    """
    db_path = tmp_path / "check.db"

    up = run_alembic("upgrade", "head", db_path=db_path)
    assert up.returncode == 0, up.stderr

    check = run_alembic("check", db_path=db_path)
    assert check.returncode == 0, f"models.py has changes with no migration:\n{check.stdout}"
