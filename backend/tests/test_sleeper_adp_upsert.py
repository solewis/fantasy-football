from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.ingest.sleeper_adp import upsert_adp_entries
from app.models import AdpEntry


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def make_record(**overrides) -> dict:
    record = {
        "platform": "sleeper",
        "platform_player_id": "1",
        "season": "2026",
        "format": "ppr",
        "adp": 10.0,
    }
    record.update(overrides)
    return record


def test_upsert_inserts_new_entries():
    session = make_session()

    count = upsert_adp_entries(session, [make_record()])

    assert count == 1
    assert session.query(AdpEntry).count() == 1


def test_upsert_is_idempotent_and_updates_adp_in_place():
    session = make_session()
    upsert_adp_entries(session, [make_record(adp=10.0)])

    upsert_adp_entries(session, [make_record(adp=12.5)])

    assert session.query(AdpEntry).count() == 1
    assert session.query(AdpEntry).one().adp == 12.5


def test_upsert_keeps_different_formats_for_same_player_distinct():
    session = make_session()

    upsert_adp_entries(session, [make_record(format="std"), make_record(format="ppr")])

    assert session.query(AdpEntry).count() == 2


def test_upsert_keeps_different_seasons_for_same_player_format_distinct():
    session = make_session()

    upsert_adp_entries(session, [make_record(season="2025"), make_record(season="2026")])

    assert session.query(AdpEntry).count() == 2
