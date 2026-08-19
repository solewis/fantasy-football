from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db import Base, get_db
from app.main import app
from app.models import AdpEntry, PlatformPlayer

engine = create_engine(
    "sqlite:///:memory:",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def override_get_db():
    db = TestSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


def setup_module() -> None:
    Base.metadata.create_all(engine)
    session = TestSessionLocal()
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
    session.add_all(
        [
            AdpEntry(
                platform="sleeper",
                platform_player_id="1",
                season="2026",
                format="half_ppr",
                adp=15.0,
            ),
            AdpEntry(
                platform="sleeper",
                platform_player_id="2",
                season="2026",
                format="half_ppr",
                adp=2.0,
            ),
        ]
    )
    session.commit()
    session.close()


def test_get_players_returns_ranked_rows():
    response = client.get("/players", params={"season": "2026", "format": "half_ppr"})

    assert response.status_code == 200
    body = response.json()
    assert [row["name"] for row in body] == ["Bijan Robinson", "Josh Allen"]
    assert [row["rank"] for row in body] == [1, 2]


def test_get_players_filters_by_position():
    response = client.get(
        "/players", params={"season": "2026", "format": "half_ppr", "position": "QB"}
    )

    assert response.status_code == 200
    assert [row["name"] for row in response.json()] == ["Josh Allen"]


def test_get_players_empty_for_unknown_format():
    response = client.get("/players", params={"season": "2026", "format": "made_up_format"})

    assert response.status_code == 200
    assert response.json() == []
