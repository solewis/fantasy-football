from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.db import Base
from app.matching.mappings import confirm_mapping, get_mapping
from app.models import NameMapping


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_confirm_mapping_persists_and_is_retrievable():
    session = make_session()

    confirm_mapping(session, "sleeper", "sheet_rank", "Pat Mahomes", "pat mahomes", "1")

    mapping = get_mapping(session, "sleeper", "sheet_rank", "pat mahomes")
    assert mapping.platform_player_id == "1"
    assert mapping.confirmed is True


def test_confirm_mapping_can_record_a_no_match():
    session = make_session()

    confirm_mapping(session, "sleeper", "adp", "Random Guy", "random guy", None)

    mapping = get_mapping(session, "sleeper", "adp", "random guy")
    assert mapping is not None
    assert mapping.platform_player_id is None


def test_reconfirming_updates_existing_row_instead_of_duplicating():
    session = make_session()
    confirm_mapping(session, "sleeper", "sheet_rank", "Pat Mahomes", "pat mahomes", "1")

    confirm_mapping(session, "sleeper", "sheet_rank", "Pat Mahomes", "pat mahomes", "2")

    assert session.query(NameMapping).count() == 1
    assert get_mapping(session, "sleeper", "sheet_rank", "pat mahomes").platform_player_id == "2"


def test_same_normalized_name_is_independent_per_source_type():
    session = make_session()
    confirm_mapping(session, "sleeper", "sheet_rank", "Pat Mahomes", "pat mahomes", "1")

    confirm_mapping(session, "sleeper", "adp", "Pat Mahomes", "pat mahomes", None)

    assert session.query(NameMapping).count() == 2
