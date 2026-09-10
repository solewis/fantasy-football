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


def test_post_exposure_creates_a_row(api_client):
    client, session_factory = api_client
    seed(session_factory)

    response = client.post(
        "/exposures",
        json={"platform": "sleeper", "season": "2026", "platform_player_id": "1", "shares": 3},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Josh Allen"
    assert body["shares"] == 3


def test_post_exposure_rejects_unknown_player(api_client):
    client, session_factory = api_client
    seed(session_factory)

    response = client.post(
        "/exposures",
        json={"platform": "sleeper", "season": "2026", "platform_player_id": "999", "shares": 1},
    )

    assert response.status_code == 400


def test_post_exposure_rejects_zero_shares(api_client):
    client, session_factory = api_client
    seed(session_factory)

    response = client.post(
        "/exposures",
        json={"platform": "sleeper", "season": "2026", "platform_player_id": "1", "shares": 0},
    )

    assert response.status_code == 400


def test_post_exposure_upserts_on_repeat_submission(api_client):
    client, session_factory = api_client
    seed(session_factory)
    client.post(
        "/exposures",
        json={"platform": "sleeper", "season": "2026", "platform_player_id": "1", "shares": 2},
    )

    response = client.post(
        "/exposures",
        json={"platform": "sleeper", "season": "2026", "platform_player_id": "1", "shares": 4},
    )

    assert response.status_code == 200
    assert response.json()["shares"] == 4
    rows = client.get("/exposures", params={"platform": "sleeper", "season": "2026"}).json()
    assert len(rows) == 1


def test_get_exposures_lists_rows_sorted_by_shares(api_client):
    client, session_factory = api_client
    seed(session_factory)
    client.post(
        "/exposures",
        json={"platform": "sleeper", "season": "2026", "platform_player_id": "1", "shares": 2},
    )
    client.post(
        "/exposures",
        json={"platform": "sleeper", "season": "2026", "platform_player_id": "2", "shares": 5},
    )

    response = client.get("/exposures", params={"platform": "sleeper", "season": "2026"})

    assert response.status_code == 200
    assert [row["name"] for row in response.json()] == ["Bijan Robinson", "Josh Allen"]


def test_delete_exposure_removes_it(api_client):
    client, session_factory = api_client
    seed(session_factory)
    created = client.post(
        "/exposures",
        json={"platform": "sleeper", "season": "2026", "platform_player_id": "1", "shares": 2},
    ).json()

    response = client.delete(f"/exposures/{created['id']}")

    assert response.status_code == 204
    rows = client.get("/exposures", params={"platform": "sleeper", "season": "2026"}).json()
    assert rows == []


def test_delete_unknown_exposure_is_400(api_client):
    client, _session_factory = api_client

    response = client.delete("/exposures/999")

    assert response.status_code == 400
