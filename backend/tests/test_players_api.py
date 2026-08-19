from app.models import AdpEntry, PlatformPlayer


def seed(session_factory) -> None:
    session = session_factory()
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


def test_get_players_returns_ranked_rows(api_client):
    client, session_factory = api_client
    seed(session_factory)

    response = client.get("/players", params={"season": "2026", "format": "half_ppr"})

    assert response.status_code == 200
    body = response.json()
    assert [row["name"] for row in body] == ["Bijan Robinson", "Josh Allen"]
    assert [row["rank"] for row in body] == [1, 2]


def test_get_players_filters_by_position(api_client):
    client, session_factory = api_client
    seed(session_factory)

    response = client.get(
        "/players", params={"season": "2026", "format": "half_ppr", "position": "QB"}
    )

    assert response.status_code == 200
    assert [row["name"] for row in response.json()] == ["Josh Allen"]


def test_get_players_empty_for_unknown_format(api_client):
    client, session_factory = api_client
    seed(session_factory)

    response = client.get("/players", params={"season": "2026", "format": "made_up_format"})

    assert response.status_code == 200
    assert response.json() == []
