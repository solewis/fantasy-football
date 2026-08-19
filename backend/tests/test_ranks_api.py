from app.models import PlatformPlayer


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
    session.commit()
    session.close()


def test_get_ranks_empty_when_nothing_saved(api_client):
    client, session_factory = api_client
    seed(session_factory)

    response = client.get("/ranks", params={"season": "2026", "format": "half_ppr"})

    assert response.status_code == 200
    assert response.json() == []


def test_put_ranks_then_get_reflects_saved_order(api_client):
    client, session_factory = api_client
    seed(session_factory)

    put_response = client.put(
        "/ranks",
        params={"season": "2026", "format": "half_ppr"},
        json={"platform_player_ids": ["2", "1"]},
    )
    assert put_response.status_code == 200
    assert put_response.json() == {"count": 2}

    get_response = client.get("/ranks", params={"season": "2026", "format": "half_ppr"})
    body = get_response.json()
    assert [row["name"] for row in body] == ["Bijan Robinson", "Josh Allen"]
    assert [row["rank"] for row in body] == [1, 2]


def test_put_ranks_replaces_rather_than_accumulates(api_client):
    client, session_factory = api_client
    seed(session_factory)

    client.put(
        "/ranks",
        params={"season": "2026", "format": "half_ppr"},
        json={"platform_player_ids": ["1", "2"]},
    )
    second = client.put(
        "/ranks",
        params={"season": "2026", "format": "half_ppr"},
        json={"platform_player_ids": ["2"]},
    )

    assert second.json() == {"count": 1}
    body = client.get("/ranks", params={"season": "2026", "format": "half_ppr"}).json()
    assert [row["name"] for row in body] == ["Bijan Robinson"]
