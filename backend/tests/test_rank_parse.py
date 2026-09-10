"""Pure parser tests -- every fixture is a string literal, no DB, no files."""

import pytest

from app.rank_import.parse import (
    ColumnMapping,
    detect_header_row,
    guess_columns,
    normalize_position,
    normalize_team,
    parse_rows,
    preview,
    read_table,
    sniff_delimiter,
    split_pos_cell,
)

FANTASYPROS = """RK,PLAYER NAME,TEAM,POS,BYE,TIERS
1,Ja'Marr Chase,CIN,WR1,10,1
2,Bijan Robinson,ATL,RB1,5,1
3,Justin Jefferson,MIN,WR2,6,2
"""


def test_sniff_delimiter_finds_comma_tab_and_semicolon():
    assert sniff_delimiter("a,b,c\n1,2,3") == ","
    assert sniff_delimiter("a\tb\tc\n1\t2\t3") == "\t"
    assert sniff_delimiter("a;b;c\n1;2;3") == ";"


def test_preamble_lines_above_the_header_are_skipped():
    text = "FantasyPros — Half PPR Rankings\n\n" + FANTASYPROS

    result = preview(text)

    assert result.header_row_index == 1
    assert result.columns[0] == "RK"
    assert [r.name for r in result.sample_rows] == [
        "Ja'Marr Chase",
        "Bijan Robinson",
        "Justin Jefferson",
    ]


def test_utf8_bom_does_not_break_header_matching():
    """A BOM rides on the first header cell, so "RK" arrives as "﻿RK" and
    matches no synonym -- silently wrecking the guess on exactly the files most
    likely to be uploaded.
    """
    result = preview("﻿" + FANTASYPROS)

    assert result.mapping.overall_rank == 0
    assert result.confidence == "high"


def test_crlf_line_endings_are_handled():
    result = preview(FANTASYPROS.replace("\n", "\r\n"))

    assert result.row_count == 3
    assert result.sample_rows[0].team == "CIN"


def test_ragged_and_blank_rows_do_not_crash():
    text = "RK,PLAYER NAME,TEAM\n1,Ja'Marr Chase\n\n2,Bijan Robinson,ATL,\n"

    result = preview(text)

    assert [r.name for r in result.sample_rows] == ["Ja'Marr Chase", "Bijan Robinson"]
    assert result.sample_rows[0].team is None


def test_unrecognized_header_reports_low_confidence():
    result = preview("colA,colB\nfoo,bar\n")

    assert result.confidence == "low"
    assert result.mapping.name is None
    assert any("name" in w for w in result.warnings)


def test_empty_file_returns_an_empty_preview():
    result = preview("")

    assert result.row_count == 0
    assert result.sample_rows == []


@pytest.mark.parametrize(
    ("cell", "expected"),
    [
        ("WR3", ("WR", 3)),
        ("WR", ("WR", None)),
        ("D/ST", ("DEF", None)),
        ("DST1", ("DEF", 1)),
        ("PK5", ("K", 5)),
        ("", (None, None)),
        ("—", (None, None)),
        ("LB2", (None, 2)),
    ],
)
def test_split_pos_cell(cell, expected):
    assert split_pos_cell(cell) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [("D/ST", "DEF"), ("DST", "DEF"), ("PK", "K"), ("FLEX", None), ("LB", None), ("wr", "WR")],
)
def test_normalize_position(value, expected):
    assert normalize_position(value) == expected


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("JAC", "JAX"),
        ("WSH", "WAS"),
        ("OAK", "LV"),
        ("STL", "LAR"),
        ("FA", None),
        ("", None),
        ("CIN", "CIN"),
        # Genuinely ambiguous between the Rams and the Chargers -- guessing
        # would give a wrong answer exactly where the point is disambiguation.
        ("LA", None),
    ],
)
def test_normalize_team(value, expected):
    assert normalize_team(value) == expected


def test_pos_column_rank_is_used_when_there_is_no_dedicated_column():
    result = preview(FANTASYPROS)

    by_name = {r.name: r for r in result.sample_rows}
    assert by_name["Ja'Marr Chase"].position_rank == 1
    assert by_name["Justin Jefferson"].position_rank == 2


def test_dedicated_column_wins_over_the_pos_cell_and_warns_on_disagreement():
    text = "RK,PLAYER NAME,POS,POS RANK\n1,Ja'Marr Chase,WR3,1\n"

    result = preview(text)

    assert result.sample_rows[0].position_rank == 1
    assert any("position column says rank 3" in w for w in result.warnings)


def test_row_order_becomes_the_rank_when_no_rank_column_exists():
    text = "PLAYER NAME,TEAM\nJa'Marr Chase,CIN\nBijan Robinson,ATL\n"

    result = preview(text)

    assert result.mapping.overall_rank_from_row_order is True
    assert [r.overall_rank for r in result.sample_rows] == [1, 2]


def test_gapped_ranks_are_kept_verbatim_not_renumbered():
    """Deltas are computed against the source's own numbers, so renumbering
    would change what the source said.
    """
    text = "RK,PLAYER NAME\n1,A One\n2,B Two\n4,C Three\n7,D Four\n"

    result = preview(text)

    assert [r.overall_rank for r in result.sample_rows] == [1, 2, 4, 7]


def test_fractional_ranks_round_and_warn_once():
    text = "ECR,PLAYER NAME\n5.3,A One\n6.8,B Two\n"

    result = preview(text)

    assert [r.overall_rank for r in result.sample_rows] == [5, 7]
    assert sum("Fractional" in w for w in result.warnings) == 1


def test_single_position_mapping_fills_a_file_with_no_position_column():
    text = "RK,PLAYER NAME\n1,Ja'Marr Chase\n2,Puka Nacua\n"
    table = read_table(text)
    mapping = ColumnMapping(name=1, overall_rank=0, single_position="WR")

    rows, _warnings = parse_rows(table, 0, mapping)

    assert {r.position for r in rows} == {"WR"}


def test_guess_columns_recognizes_common_header_spellings():
    mapping, confidence = guess_columns(["RK", "PLAYER NAME", "TEAM", "POS", "TIERS"])

    assert confidence == "high"
    assert mapping.overall_rank == 0
    assert mapping.name == 1
    assert mapping.team == 2
    assert mapping.position == 3
    assert mapping.tier == 4


def test_detect_header_row_needs_a_name_column():
    table = read_table("RK,TIER\n1,1\nRK,PLAYER,TEAM\n1,A One,CIN\n")

    assert detect_header_row(table) == 2
