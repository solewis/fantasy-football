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
    session.commit()
    session.close()


def seed_adp(session_factory) -> None:
    """The shared seed() above deliberately has no ADP rows, and seeding a rank
    set inner-joins ADP -- so any test using seed_from_adp needs these too.
    """
    session = session_factory()
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


def test_post_rank_set_first_positional_set_is_active(api_client):
    client, session_factory = api_client
    seed(session_factory)

    rank_set = create_rank_set(client, name="My QBs", scope="QB")

    assert rank_set["is_active"] is True


def test_post_activate_rank_set_switches_active_flag(api_client):
    client, session_factory = api_client
    seed(session_factory)
    first = create_rank_set(client, name="My QBs", scope="QB")
    second = create_rank_set(client, name="QB backup", scope="QB")
    assert second["is_active"] is False

    response = client.post(f"/rank-sets/{second['id']}/activate")

    assert response.status_code == 200
    assert response.json()["is_active"] is True
    rows = client.get(
        "/rank-sets", params={"season": "2026", "format": "half_ppr", "scope": "QB"}
    ).json()
    by_id = {row["id"]: row["is_active"] for row in rows}
    assert by_id[first["id"]] is False
    assert by_id[second["id"]] is True


def test_post_activate_rank_set_rejects_overall_scope(api_client):
    client, session_factory = api_client
    seed(session_factory)
    rank_set = create_rank_set(client, name="Main")

    response = client.post(f"/rank-sets/{rank_set['id']}/activate")

    assert response.status_code == 400


def test_post_activate_rank_set_rejects_unknown_id(api_client):
    client, session_factory = api_client
    seed(session_factory)

    response = client.post("/rank-sets/999/activate")

    assert response.status_code == 400


def test_delete_rank_set_promotes_another_active_set(api_client):
    client, session_factory = api_client
    seed(session_factory)
    first = create_rank_set(client, name="My QBs", scope="QB")
    second = create_rank_set(client, name="QB backup", scope="QB")

    client.delete(f"/rank-sets/{first['id']}")

    rows = client.get(
        "/rank-sets", params={"season": "2026", "format": "half_ppr", "scope": "QB"}
    ).json()
    assert len(rows) == 1
    assert rows[0]["id"] == second["id"]
    assert rows[0]["is_active"] is True


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


def test_post_rank_set_with_positional_scope(api_client):
    client, session_factory = api_client
    seed(session_factory)
    seed_adp(session_factory)

    body = create_rank_set(client, name="My RBs", scope="RB", seed_from_adp=True)

    assert body["scope"] == "RB"
    rows = client.get(f"/rank-sets/{body['id']}/ranks").json()
    assert [r["position"] for r in rows] == ["RB"]


def test_post_rank_set_rejects_unknown_scope(api_client):
    client, _session_factory = api_client

    response = client.post(
        "/rank-sets", json={"name": "Kickers", "scope": "K", "seed_from_adp": False}
    )

    assert response.status_code == 400


def test_get_rank_sets_filters_by_scope(api_client):
    client, session_factory = api_client
    seed(session_factory)
    create_rank_set(client, name="Main", seed_from_adp=False)
    create_rank_set(client, name="My RBs", scope="RB", seed_from_adp=False)

    rows = client.get("/rank-sets?platform=sleeper&scope=RB").json()

    assert [r["name"] for r in rows] == ["My RBs"]


def test_put_ranks_accepts_the_entries_shape_with_tiers(api_client):
    client, session_factory = api_client
    seed(session_factory)
    rank_set_id = create_rank_set(client, seed_from_adp=False)["id"]

    response = client.put(
        f"/rank-sets/{rank_set_id}/ranks",
        json={
            "entries": [
                {"platform_player_id": "2", "tier": 1},
                {"platform_player_id": "1", "tier": 2},
            ]
        },
    )

    assert response.status_code == 200
    assert response.json() == {"count": 2}
    rows = client.get(f"/rank-sets/{rank_set_id}/ranks").json()
    assert [(r["platform_player_id"], r["tier"]) for r in rows] == [("2", 1), ("1", 2)]


def test_put_ranks_still_accepts_the_legacy_id_list_shape(api_client):
    """The frontend posts this shape until it switches over -- see
    ReplaceRanksRequest's docstring.
    """
    client, session_factory = api_client
    seed(session_factory)
    rank_set_id = create_rank_set(client, seed_from_adp=False)["id"]

    response = client.put(
        f"/rank-sets/{rank_set_id}/ranks", json={"platform_player_ids": ["1", "2"]}
    )

    assert response.status_code == 200
    rows = client.get(f"/rank-sets/{rank_set_id}/ranks").json()
    assert [r["platform_player_id"] for r in rows] == ["1", "2"]
    assert [r["tier"] for r in rows] == [None, None]


def test_put_ranks_rejects_both_shapes_at_once(api_client):
    client, session_factory = api_client
    seed(session_factory)
    rank_set_id = create_rank_set(client, seed_from_adp=False)["id"]

    response = client.put(
        f"/rank-sets/{rank_set_id}/ranks",
        json={"platform_player_ids": ["1"], "entries": [{"platform_player_id": "2"}]},
    )

    assert response.status_code == 422


def test_put_ranks_rejects_neither_shape(api_client):
    client, session_factory = api_client
    seed(session_factory)
    rank_set_id = create_rank_set(client, seed_from_adp=False)["id"]

    assert client.put(f"/rank-sets/{rank_set_id}/ranks", json={}).status_code == 422


def test_get_ranks_ignores_a_positional_set_with_a_lower_id(api_client):
    """The draft player pool reads GET /ranks -- a positional set winning the
    resolver would silently give it a board of one position.
    """
    client, session_factory = api_client
    seed(session_factory)
    seed_adp(session_factory)
    create_rank_set(client, name="My RBs", scope="RB", seed_from_adp=True)
    overall = create_rank_set(client, name="Main", seed_from_adp=True)

    rows = client.get("/ranks?platform=sleeper&season=2026&format=half_ppr").json()

    assert len(rows) == len(client.get(f"/rank-sets/{overall['id']}/ranks").json())
    assert {r["position"] for r in rows} == {"QB", "RB"}
