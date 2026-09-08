import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import exposure
from app.db import Base
from app.models import PlatformPlayer


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def seed_players(session: Session) -> None:
    session.add_all(
        [
            PlatformPlayer(
                platform="sleeper",
                platform_player_id="1",
                name="Josh Allen",
                position="QB",
                team="BUF",
            ),
            PlatformPlayer(
                platform="sleeper",
                platform_player_id="2",
                name="Bijan Robinson",
                position="RB",
                team="ATL",
            ),
        ]
    )
    session.commit()


def test_set_exposure_creates_a_new_row():
    session = make_session()
    seed_players(session)

    row = exposure.set_exposure(session, "sleeper", "2026", "1", 3)

    assert row["name"] == "Josh Allen"
    assert row["shares"] == 3
    assert row["position"] == "QB"
    assert row["team"] == "BUF"


def test_set_exposure_replaces_not_accumulates():
    session = make_session()
    seed_players(session)
    exposure.set_exposure(session, "sleeper", "2026", "1", 3)

    row = exposure.set_exposure(session, "sleeper", "2026", "1", 5)

    assert row["shares"] == 5
    rows = exposure.list_exposures(session, "sleeper", "2026")
    assert len(rows) == 1
    assert rows[0]["shares"] == 5


def test_set_exposure_rejects_zero_shares():
    session = make_session()
    seed_players(session)

    with pytest.raises(exposure.ExposureError):
        exposure.set_exposure(session, "sleeper", "2026", "1", 0)


def test_set_exposure_rejects_negative_shares():
    session = make_session()
    seed_players(session)

    with pytest.raises(exposure.ExposureError):
        exposure.set_exposure(session, "sleeper", "2026", "1", -1)


def test_set_exposure_rejects_unknown_player():
    session = make_session()

    with pytest.raises(exposure.ExposureError):
        exposure.set_exposure(session, "sleeper", "2026", "999", 1)


def test_list_exposures_sorted_by_shares_descending():
    session = make_session()
    seed_players(session)
    exposure.set_exposure(session, "sleeper", "2026", "1", 2)
    exposure.set_exposure(session, "sleeper", "2026", "2", 5)

    rows = exposure.list_exposures(session, "sleeper", "2026")

    assert [r["name"] for r in rows] == ["Bijan Robinson", "Josh Allen"]


def test_list_exposures_scoped_by_season():
    session = make_session()
    seed_players(session)
    exposure.set_exposure(session, "sleeper", "2026", "1", 2)
    exposure.set_exposure(session, "sleeper", "2027", "2", 5)

    rows = exposure.list_exposures(session, "sleeper", "2026")

    assert [r["name"] for r in rows] == ["Josh Allen"]


def test_list_exposures_without_season_returns_all_seasons():
    session = make_session()
    seed_players(session)
    exposure.set_exposure(session, "sleeper", "2026", "1", 2)
    exposure.set_exposure(session, "sleeper", "2027", "2", 5)

    rows = exposure.list_exposures(session, "sleeper")

    assert {r["name"] for r in rows} == {"Josh Allen", "Bijan Robinson"}


def test_delete_exposure_removes_it():
    session = make_session()
    seed_players(session)
    row = exposure.set_exposure(session, "sleeper", "2026", "1", 2)

    exposure.delete_exposure(session, row["id"])

    assert exposure.list_exposures(session, "sleeper", "2026") == []


def test_delete_unknown_exposure_raises():
    session = make_session()

    with pytest.raises(exposure.ExposureError):
        exposure.delete_exposure(session, 999)
