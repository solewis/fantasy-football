from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.ingest.sleeper import upsert_players
from app.models import PlatformPlayer


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_upsert_inserts_new_players():
    session = make_session()
    record = {
        "platform": "sleeper",
        "platform_player_id": "1",
        "name": "A B",
        "position": "RB",
        "team": "KC",
    }

    count = upsert_players(session, [record])

    assert count == 1
    assert session.query(PlatformPlayer).count() == 1


def test_upsert_is_idempotent_and_updates_in_place():
    session = make_session()
    record = {
        "platform": "sleeper",
        "platform_player_id": "1",
        "name": "A B",
        "position": "RB",
        "team": "KC",
    }
    upsert_players(session, [record])

    upsert_players(session, [dict(record, team="DEN")])

    assert session.query(PlatformPlayer).count() == 1
    assert session.query(PlatformPlayer).one().team == "DEN"


def test_upsert_keeps_same_id_players_on_different_platforms_distinct():
    session = make_session()
    sleeper_record = {
        "platform": "sleeper",
        "platform_player_id": "1",
        "name": "A B",
        "position": "RB",
        "team": "KC",
    }
    espn_record = {
        "platform": "espn",
        "platform_player_id": "1",
        "name": "C D",
        "position": "WR",
        "team": "SF",
    }

    upsert_players(session, [sleeper_record, espn_record])

    assert session.query(PlatformPlayer).count() == 2
