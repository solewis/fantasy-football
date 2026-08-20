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


def create_rank_set(client, **overrides):
    payload = {
        "name": "Main",
        "season": "2026",
        "format": "half_ppr",
        "seed_from_adp": False,
    }
    payload.update(overrides)
    response = client.post("/rank-sets", json=payload)
    assert response.status_code == 200
    return response.json()


def test_get_rank_sets_lists_created_sets(api_client):
    client, session_factory = api_client
    seed(session_factory)
    create_rank_set(client, name="Main")
    create_rank_set(client, name="Backup")

    response = client.get("/rank-sets", params={"season": "2026", "format": "half_ppr"})

    assert response.status_code == 200
    names = {row["name"] for row in response.json()}
    assert names == {"Main", "Backup"}
    assert all(row["player_count"] == 0 for row in response.json())


def test_get_rank_sets_scoped_by_format(api_client):
    client, session_factory = api_client
    seed(session_factory)
    create_rank_set(client, name="Main", format="half_ppr")
    create_rank_set(client, name="Main", format="std")

    response = client.get("/rank-sets", params={"season": "2026", "format": "half_ppr"})

    assert [row["format"] for row in response.json()] == ["half_ppr"]


def test_post_rank_set_duplicate_name_is_400(api_client):
    client, session_factory = api_client
    seed(session_factory)
    create_rank_set(client, name="Main")

    response = client.post(
        "/rank-sets",
        json={"name": "Main", "season": "2026", "format": "half_ppr", "seed_from_adp": False},
    )

    assert response.status_code == 400


def test_patch_rank_set_renames(api_client):
    client, session_factory = api_client
    seed(session_factory)
    rank_set = create_rank_set(client, name="Main")

    response = client.patch(f"/rank-sets/{rank_set['id']}", json={"name": "Renamed"})

    assert response.status_code == 200
    assert response.json()["name"] == "Renamed"


def test_delete_rank_set_removes_it(api_client):
    client, session_factory = api_client
    seed(session_factory)
    rank_set = create_rank_set(client, name="Main")

    response = client.delete(f"/rank-sets/{rank_set['id']}")

    assert response.status_code == 204
    remaining = client.get("/rank-sets", params={"season": "2026", "format": "half_ppr"}).json()
    assert remaining == []


def test_put_and_get_ranks_for_a_set(api_client):
    client, session_factory = api_client
    seed(session_factory)
    rank_set = create_rank_set(client, name="Main")

    put_response = client.put(
        f"/rank-sets/{rank_set['id']}/ranks",
        json={"platform_player_ids": ["2", "1"]},
    )
    assert put_response.status_code == 200
    assert put_response.json() == {"count": 2}

    get_response = client.get(f"/rank-sets/{rank_set['id']}/ranks")
    body = get_response.json()
    assert [row["name"] for row in body] == ["Bijan Robinson", "Josh Allen"]
    assert [row["rank"] for row in body] == [1, 2]


def test_get_ranks_resolver_empty_when_no_sets_exist(api_client):
    client, session_factory = api_client
    seed(session_factory)

    response = client.get("/ranks", params={"season": "2026", "format": "half_ppr"})

    assert response.status_code == 200
    assert response.json() == []


def test_get_ranks_resolver_reflects_the_first_created_sets_order(api_client):
    client, session_factory = api_client
    seed(session_factory)
    rank_set = create_rank_set(client, name="Main")
    client.put(f"/rank-sets/{rank_set['id']}/ranks", json={"platform_player_ids": ["2", "1"]})

    response = client.get("/ranks", params={"season": "2026", "format": "half_ppr"})

    body = response.json()
    assert [row["name"] for row in body] == ["Bijan Robinson", "Josh Allen"]
