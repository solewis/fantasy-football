import pytest

from app.rank_import.refs import RankRefError, format_source_ref, parse_source_ref


@pytest.mark.parametrize(
    ("kind", "source_id", "ref"),
    [("adp", None, "adp"), ("dataset", 7, "dataset:7"), ("rank_set", 3, "rank_set:3")],
)
def test_round_trip(kind, source_id, ref):
    assert format_source_ref(kind, source_id) == ref
    assert parse_source_ref(ref) == (kind, source_id)


@pytest.mark.parametrize("ref", ["nonsense", "dataset:abc", "dataset", "", "league:1", "adp:1"])
def test_unparseable_refs_raise_rather_than_resolving_to_nothing(ref):
    """A silently-empty source reads exactly like "this source has no opinion
    about anyone" further downstream, and the builder would look broken rather
    than reporting a bad request.
    """
    with pytest.raises(RankRefError):
        parse_source_ref(ref)


def test_formatting_an_id_kind_without_an_id_raises():
    with pytest.raises(RankRefError):
        format_source_ref("dataset")
