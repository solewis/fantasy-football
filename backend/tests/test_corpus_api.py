from app.models import PlatformPlayer

ANALYST = "The Guide Guy"


def seed_players(session_factory):
    db = session_factory()
    for player_id, name, position in [
        ("1", "Justin Jefferson", "WR"),
        ("2", "Christian McCaffrey", "RB"),
        ("4", "Bijan Robinson", "RB"),
    ]:
        db.add(
            PlatformPlayer(
                platform="sleeper", platform_player_id=player_id, name=name, position=position
            )
        )
    db.commit()
    db.close()


def post_document(client, title="Draft Guide", text="Bijan Robinson is my RB1.", **kwargs):
    payload = {"analyst": ANALYST, "title": title, "kind": "article", "text": text, **kwargs}
    return client.post("/corpus/documents", json=payload)


def test_import_returns_a_summary(api_client):
    client, session_factory = api_client
    seed_players(session_factory)

    response = post_document(client, published_at="2026-08-01T00:00:00Z")
    assert response.status_code == 200
    body = response.json()
    assert body["analyst"] == ANALYST
    assert body["chunk_count"] == 1
    assert body["mention_count"] == 1
    assert body["published_at"].startswith("2026-08-01")


def test_import_rejects_a_bad_kind(api_client):
    client, session_factory = api_client
    seed_players(session_factory)

    response = post_document(client, kind="newsletter")
    assert response.status_code == 400
    assert "Unknown document kind" in response.json()["detail"]


def test_duplicate_title_is_a_400(api_client):
    client, session_factory = api_client
    seed_players(session_factory)

    assert post_document(client).status_code == 200
    response = post_document(client)
    assert response.status_code == 400
    assert "already has a document" in response.json()["detail"]


def test_list_and_filter_by_analyst(api_client):
    client, session_factory = api_client
    seed_players(session_factory)

    post_document(client, title="Mine")
    client.post(
        "/corpus/documents",
        json={"analyst": "Other", "title": "Theirs", "kind": "article", "text": "Bijan Robinson."},
    )

    assert len(client.get("/corpus/documents").json()) == 2
    filtered = client.get("/corpus/documents", params={"analyst": ANALYST}).json()
    assert [d["title"] for d in filtered] == ["Mine"]


def test_passages_endpoint_returns_grounded_text(api_client):
    client, session_factory = api_client
    seed_players(session_factory)
    post_document(client, text="Bijan Robinson is my RB1 and I am not moving off it.")

    response = client.get("/corpus/passages", params={"platform_player_id": ["4"]})
    assert response.status_code == 200
    body = response.json()
    assert "Bijan Robinson is my RB1" in body["4"][0]["text"]
    assert body["4"][0]["document_title"] == "Draft Guide"


def test_passages_are_empty_for_an_unmentioned_player(api_client):
    client, session_factory = api_client
    seed_players(session_factory)
    post_document(client)

    assert client.get("/corpus/passages", params={"platform_player_id": ["1"]}).json() == {}


def test_alias_then_rescan_makes_a_nickname_findable(api_client):
    client, session_factory = api_client
    seed_players(session_factory)
    document = post_document(client, title="Nicknames", text="CMC is all the way back.").json()

    assert client.get("/corpus/passages", params={"platform_player_id": ["2"]}).json() == {}

    alias = client.post(
        "/corpus/aliases",
        json={"normalized_name": "cmc", "source_name_raw": "CMC", "platform_player_id": "2"},
    )
    assert alias.status_code == 200

    rescan = client.post(f"/corpus/documents/{document['id']}/rescan")
    assert rescan.status_code == 200
    assert rescan.json()["mention_count"] == 1

    found = client.get("/corpus/passages", params={"platform_player_id": ["2"]}).json()
    assert found["2"][0]["detected_by"] == "alias"


def test_delete_removes_the_document(api_client):
    client, session_factory = api_client
    seed_players(session_factory)
    document = post_document(client).json()

    assert client.delete(f"/corpus/documents/{document['id']}").status_code == 204
    assert client.get("/corpus/documents").json() == []
    assert client.get(f"/corpus/documents/{document['id']}").status_code == 404


def test_rescan_of_a_missing_document_is_a_404(api_client):
    client, _ = api_client
    assert client.post("/corpus/documents/999/rescan").status_code == 404
