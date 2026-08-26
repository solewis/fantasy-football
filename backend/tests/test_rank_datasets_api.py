from app.models import AdpEntry, PlatformPlayer

CSV = """RK,PLAYER NAME,TEAM,POS,TIERS
1,Ja'Marr Chase,CIN,WR1,1
2,Bijan Robinson,ATL,RB1,1
3,Justin Jefferson,MIN,WR2,2
"""


def seed(session_factory) -> None:
    session = session_factory()
    for pid, name, position, team, adp in [
        ("1", "Ja'Marr Chase", "WR", "CIN", 3.2),
        ("2", "Bijan Robinson", "RB", "ATL", 2.4),
        ("3", "Justin Jefferson", "WR", "MIN", 13.9),
    ]:
        session.add(
            PlatformPlayer(
                platform="sleeper", platform_player_id=pid, name=name, position=position, team=team
            )
        )
        session.add(
            AdpEntry(
                platform="sleeper",
                platform_player_id=pid,
                season="2026",
                format="half_ppr",
                adp=adp,
            )
        )
    session.commit()
    session.close()


def import_dataset(client, name="FantasyPros", text=CSV, **overrides):
    payload = {"name": name, "text": text, "season": "2026", "format": "half_ppr"}
    payload.update(overrides)
    response = client.post("/rank-datasets", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def test_preview_guesses_the_column_mapping_and_returns_samples(api_client):
    client, _ = api_client

    body = client.post("/rank-datasets/preview", json={"text": CSV}).json()

    assert body["confidence"] == "high"
    assert body["columns"] == ["RK", "PLAYER NAME", "TEAM", "POS", "TIERS"]
    assert body["mapping"]["name"] == 1
    assert body["mapping"]["overall_rank"] == 0
    assert body["detected"] == {"has_overall": True, "has_positional": True, "has_tier": True}
    assert body["sample_rows"][0]["source_name_raw"] == "Ja'Marr Chase"


def test_preview_skips_preamble_above_the_header(api_client):
    client, _ = api_client

    body = client.post("/rank-datasets/preview", json={"text": "Some Title\n\n" + CSV}).json()

    assert body["header_row_index"] == 1
    assert body["row_count"] == 3


def test_import_then_list_and_detail(api_client):
    client, session_factory = api_client
    seed(session_factory)

    created = import_dataset(client)

    assert created["row_count"] == 3
    assert created["has_overall"] is True
    assert created["resolution"]["needs_review"] == 0

    listed = client.get("/rank-datasets?season=2026&format=half_ppr").json()
    assert [d["name"] for d in listed] == ["FantasyPros"]

    detail = client.get(f"/rank-datasets/{created['id']}").json()
    assert detail["id"] == created["id"]


def test_import_with_a_duplicate_name_is_400(api_client):
    client, session_factory = api_client
    seed(session_factory)
    import_dataset(client)

    response = client.post(
        "/rank-datasets",
        json={"name": "FantasyPros", "text": CSV, "season": "2026", "format": "half_ppr"},
    )

    assert response.status_code == 400


def test_import_of_an_empty_file_is_400(api_client):
    client, _ = api_client

    response = client.post("/rank-datasets", json={"name": "Empty", "text": ""})

    assert response.status_code == 400


def test_unknown_dataset_detail_is_404(api_client):
    client, _ = api_client

    assert client.get("/rank-datasets/999").status_code == 404


def test_unmatched_then_bulk_confirm_clears_the_queue(api_client):
    client, session_factory = api_client
    seed(session_factory)
    created = import_dataset(client, name="Nicknames", text="RK,PLAYER NAME,POS\n1,Uncle Rico,WR\n")

    unmatched = client.get(f"/rank-datasets/{created['id']}/unmatched").json()
    assert [u["source_name_raw"] for u in unmatched] == ["Uncle Rico"]
    assert unmatched[0]["candidates"]

    response = client.post(
        f"/rank-datasets/{created['id']}/mappings",
        json={
            "confirmations": [
                {
                    "normalized_name": unmatched[0]["normalized_name"],
                    "source_name_raw": "Uncle Rico",
                    "platform_player_id": "1",
                }
            ]
        },
    )

    assert response.status_code == 200
    assert response.json() == {"confirmed": 1, "remaining_unmatched": 0}


def test_reparse_with_a_corrected_mapping_keeps_the_id(api_client):
    client, session_factory = api_client
    seed(session_factory)
    created = import_dataset(client)

    response = client.post(
        f"/rank-datasets/{created['id']}/reparse",
        json={"mapping": {"name": 1, "team": 2, "position": 3, "overall_rank": 4}},
    )

    assert response.status_code == 200
    assert response.json()["id"] == created["id"]


def test_rename_and_delete(api_client):
    client, session_factory = api_client
    seed(session_factory)
    created = import_dataset(client)

    renamed = client.patch(f"/rank-datasets/{created['id']}", json={"name": "Renamed"})
    assert renamed.status_code == 200
    assert renamed.json()["name"] == "Renamed"

    assert client.delete(f"/rank-datasets/{created['id']}").status_code == 204
    assert client.get("/rank-datasets").json() == []


def test_rank_sources_lists_adp_datasets_and_rank_sets(api_client):
    client, session_factory = api_client
    seed(session_factory)
    import_dataset(client)
    client.post(
        "/rank-sets",
        json={
            "name": "My WRs",
            "season": "2026",
            "format": "half_ppr",
            "scope": "WR",
            "seed_from_adp": False,
        },
    )

    sources = client.get("/rank-sources?platform=sleeper&season=2026&format=half_ppr").json()

    by_label = {s["label"]: s for s in sources}
    assert by_label["ADP"]["ref"] == "adp"
    assert by_label["FantasyPros"]["supports_overall"] is True
    assert by_label["My WRs"]["supports_overall"] is False


def test_rank_pool_returns_each_sources_rank_per_player(api_client):
    client, session_factory = api_client
    seed(session_factory)
    created = import_dataset(client)

    pool = client.get(
        f"/rank-pool?platform=sleeper&season=2026&format=half_ppr"
        f"&source_ref=adp&source_ref=dataset:{created['id']}"
    ).json()

    assert {s["ref"] for s in pool["sources"]} == {"adp", f"dataset:{created['id']}"}
    by_name = {p["name"]: p for p in pool["players"]}
    assert by_name["Ja'Marr Chase"]["ranks"][f"dataset:{created['id']}"] == 1
    assert by_name["Bijan Robinson"]["ranks"]["adp"] == 1
    # no averages, no ordering by merit -- the tool reports, the human decides
    assert "consensus" not in by_name["Ja'Marr Chase"]


def test_rank_pool_with_a_positional_only_source_on_an_overall_build_is_400(api_client):
    client, session_factory = api_client
    seed(session_factory)
    created = import_dataset(
        client,
        name="WR only",
        text="PLAYER NAME,POS RANK,POS\nJa'Marr Chase,1,WR\nJustin Jefferson,2,WR\n",
    )

    response = client.get(
        f"/rank-pool?platform=sleeper&season=2026&format=half_ppr"
        f"&source_ref=dataset:{created['id']}&scope=overall"
    )

    assert response.status_code == 400
    assert "overall" in response.json()["detail"]


def test_rank_pool_with_a_bad_source_ref_is_400(api_client):
    client, _ = api_client

    response = client.get("/rank-pool?source_ref=nonsense")

    assert response.status_code == 400
