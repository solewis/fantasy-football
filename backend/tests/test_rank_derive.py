"""Pure derivation tests.

The assertion that matters most is
test_positional_only_input_never_invents_an_overall_rank -- everything
downstream depends on a positional-only dataset being excluded from overall
builds rather than quietly guessing.
"""

from app.rank_import.derive import derive_dataset
from app.rank_import.parse import RawRankRow


def row(index, name, **kwargs) -> RawRankRow:
    return RawRankRow(row_index=index, name=name, **kwargs)


def test_overall_only_input_derives_positional_ranks_within_each_position():
    rows = [
        row(0, "Ja'Marr Chase", position="WR", overall_rank=1),
        row(1, "Bijan Robinson", position="RB", overall_rank=2),
        row(2, "Justin Jefferson", position="WR", overall_rank=3),
        row(3, "Saquon Barkley", position="RB", overall_rank=4),
        row(4, "Puka Nacua", position="WR", overall_rank=5),
    ]

    result = derive_dataset(rows)

    by_name = {r.source_name_raw: r for r in result.rows}
    assert by_name["Ja'Marr Chase"].position_rank == 1
    assert by_name["Justin Jefferson"].position_rank == 2
    assert by_name["Puka Nacua"].position_rank == 3
    assert by_name["Bijan Robinson"].position_rank == 1
    assert by_name["Saquon Barkley"].position_rank == 2
    assert all(r.position_rank_derived for r in result.rows)
    assert result.has_overall is True
    assert result.has_positional is True


def test_positional_only_input_never_invents_an_overall_rank():
    """Interleaving QB1/RB1/WR1 into one order needs value information the file
    doesn't carry. Such a dataset is excluded from overall builds instead.
    """
    rows = [
        row(0, "Ja'Marr Chase", position="WR", position_rank=1),
        row(1, "Bijan Robinson", position="RB", position_rank=1),
        row(2, "Justin Jefferson", position="WR", position_rank=2),
    ]

    result = derive_dataset(rows)

    assert all(r.overall_rank is None for r in result.rows)
    assert result.has_overall is False
    assert result.has_positional is True


def test_supplied_positional_ranks_are_kept_verbatim_even_when_they_disagree():
    """That disagreement is what the source published -- silently "fixing" it
    would misreport them in the builder.
    """
    rows = [
        row(0, "Ja'Marr Chase", position="WR", overall_rank=1, position_rank=2),
        row(1, "Justin Jefferson", position="WR", overall_rank=3, position_rank=1),
    ]

    result = derive_dataset(rows)

    by_name = {r.source_name_raw: r for r in result.rows}
    assert by_name["Ja'Marr Chase"].position_rank == 2
    assert by_name["Justin Jefferson"].position_rank == 1
    assert not any(r.position_rank_derived for r in result.rows)


def test_gapped_overall_ranks_are_not_renumbered():
    rows = [
        row(0, "A One", position="WR", overall_rank=1),
        row(1, "B Two", position="WR", overall_rank=4),
        row(2, "C Three", position="WR", overall_rank=7),
    ]

    result = derive_dataset(rows)

    assert [r.overall_rank for r in result.rows] == [1, 4, 7]
    # ...but the derived positional ranks are dense
    assert [r.position_rank for r in result.rows] == [1, 2, 3]


def test_tied_overall_ranks_break_by_file_order_and_warn():
    rows = [
        row(0, "A One", position="WR", overall_rank=5),
        row(1, "B Two", position="WR", overall_rank=5),
    ]

    result = derive_dataset(rows)

    assert [r.position_rank for r in result.rows] == [1, 2]
    assert any("share an overall rank" in w for w in result.warnings)


def test_rows_without_a_position_keep_their_overall_rank():
    rows = [
        row(0, "A One", overall_rank=1),
        row(1, "B Two", position="WR", overall_rank=2),
    ]

    result = derive_dataset(rows)

    by_name = {r.source_name_raw: r for r in result.rows}
    assert by_name["A One"].overall_rank == 1
    assert by_name["A One"].position_rank is None


def test_duplicate_name_and_position_keeps_the_first_and_warns():
    rows = [
        row(0, "Ja'Marr Chase", position="WR", overall_rank=1),
        row(1, "Ja'Marr Chase", position="WR", overall_rank=40),
    ]

    result = derive_dataset(rows)

    assert len(result.rows) == 1
    assert result.rows[0].overall_rank == 1
    assert any("more than once" in w for w in result.warnings)


def test_same_name_at_different_positions_is_not_a_duplicate():
    rows = [
        row(0, "Josh Allen", position="QB", overall_rank=1),
        row(1, "Josh Allen", position="RB", overall_rank=200),
    ]

    result = derive_dataset(rows)

    assert len(result.rows) == 2


def test_tiers_are_kept_verbatim_and_never_inferred():
    with_tiers = derive_dataset([row(0, "A One", position="WR", overall_rank=1, tier=2)])
    without = derive_dataset([row(0, "A One", position="WR", overall_rank=1)])

    assert with_tiers.rows[0].tier == 2
    assert with_tiers.has_tier is True
    assert without.rows[0].tier is None
    assert without.has_tier is False


def test_unreadable_name_is_skipped_with_a_warning():
    result = derive_dataset([row(0, "!!!"), row(1, "Ja'Marr Chase", overall_rank=1)])

    assert [r.source_name_raw for r in result.rows] == ["Ja'Marr Chase"]
    assert any("couldn't read a player name" in w for w in result.warnings)


def test_empty_input_produces_an_empty_dataset():
    result = derive_dataset([])

    assert result.rows == []
    assert result.has_overall is False
    assert result.has_positional is False
    assert result.has_tier is False


def test_names_are_normalized_for_matching():
    result = derive_dataset([row(0, "Ja'Marr Chase Jr.", position="WR", overall_rank=1)])

    assert result.rows[0].normalized_name == "jamarr chase"
    assert result.rows[0].source_name_raw == "Ja'Marr Chase Jr."
