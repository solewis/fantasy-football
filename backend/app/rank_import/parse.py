"""Parse a third-party ranking file into raw rows plus a guessed column mapping.

Pure: takes the file's text, returns data. No DB, no HTTP, no filesystem -- so
every test here is a triple-quoted string, the same way app/draft_logic.py is
tested with plain numbers.

Third-party ranking exports vary wildly: different delimiters, preamble junk
above the real header, a dozen spellings of "rank", positions written as "WR3"
in one column or split across two, and team abbreviations that disagree between
sources. All of that normalizing happens here, at the boundary, so nothing
downstream (app/matching in particular) has to know about other sites' habits.
"""

import csv
import io
import re
from dataclasses import dataclass, field, replace

POSITIONS = ("QB", "RB", "WR", "TE", "K", "DEF")

# Third-party spellings -> this app's vocabulary. FLEX/SUPERFLEX map to None on
# purpose: they aren't real positions, and a flex row duplicates a positional
# row that's already in the file.
_POSITION_ALIASES = {
    "QB": "QB",
    "RB": "RB",
    "WR": "WR",
    "TE": "TE",
    "K": "K",
    "PK": "K",
    "KICKER": "K",
    "DEF": "DEF",
    "DST": "DEF",
    "D/ST": "DEF",
    "D": "DEF",
    "DEFENSE": "DEF",
}

# Team abbreviations differ across sources. LA is deliberately absent: it's
# genuinely ambiguous between the Rams and the Chargers, and guessing gives a
# wrong answer where the whole point is disambiguation -- None is better.
_TEAM_ALIASES = {
    "JAC": "JAX",
    "JAG": "JAX",
    "WSH": "WAS",
    "WFT": "WAS",
    "SD": "LAC",
    "SDG": "LAC",
    "STL": "LAR",
    "OAK": "LV",
    "LVR": "LV",
    "ARZ": "ARI",
    "BLT": "BAL",
    "CLV": "CLE",
    "HST": "HOU",
    "TAM": "TB",
    "NWE": "NE",
    "NOR": "NO",
    "SFO": "SF",
    "GNB": "GB",
    "KAN": "KC",
}
_NO_TEAM = {"FA", "FA*", "-", "--", "NONE", "N/A", "LA"}

# Header synonyms, checked longest-first so "pos rank" beats "pos".
_HEADER_SYNONYMS: list[tuple[str, tuple[str, ...]]] = [
    ("position_rank", ("pos rank", "positional rank", "pos rk", "posrank", "position rank")),
    ("overall_rank", ("overall rank", "overall", "rank", "rk", "ovr", "ecr", "#")),
    ("name", ("player name", "full name", "player", "name")),
    ("position", ("position", "pos")),
    ("team", ("nfl team", "team", "tm")),
    ("tier", ("tier", "tiers")),
]

_FIELDS = ("name", "position", "team", "overall_rank", "position_rank", "tier")


@dataclass(frozen=True)
class ColumnMapping:
    """Which column index feeds which field. None means "not in this file"."""

    name: int | None = None
    position: int | None = None
    team: int | None = None
    overall_rank: int | None = None
    position_rank: int | None = None
    tier: int | None = None
    # Set when the file is an ordered list with no rank column at all, so its
    # row order *is* the ranking.
    overall_rank_from_row_order: bool = False
    # Set when the file is all one position and doesn't say so in a column.
    single_position: str | None = None


@dataclass(frozen=True)
class RawRankRow:
    row_index: int
    name: str
    position: str | None = None
    team: str | None = None
    overall_rank: int | None = None
    position_rank: int | None = None
    tier: int | None = None


@dataclass(frozen=True)
class ParsePreview:
    delimiter: str
    header_row_index: int
    columns: list[str]
    mapping: ColumnMapping
    confidence: str  # "high" | "low"
    sample_rows: list[RawRankRow]
    row_count: int
    warnings: list[str] = field(default_factory=list)


def _clean(text: str) -> str:
    """Strip the UTF-8 BOM and normalize line endings.

    Both are near-universal in spreadsheet exports, and a BOM is especially
    nasty: it rides on the *first header cell*, so "RK" arrives as "﻿RK"
    and never matches a synonym -- the whole mapping guess then silently fails
    on exactly the files most likely to be uploaded.
    """
    return text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")


def sniff_delimiter(text: str) -> str:
    """Pick the delimiter by counting candidates in the densest early line.

    csv.Sniffer is tempting but throws on short or irregular files, which
    ranking exports frequently are.
    """
    lines = [line for line in _clean(text).split("\n") if line.strip()][:20]
    if not lines:
        return ","
    best, best_count = ",", 0
    for candidate in (",", "\t", ";", "|"):
        count = max(line.count(candidate) for line in lines)
        if count > best_count:
            best, best_count = candidate, count
    return best


def read_table(text: str, delimiter: str | None = None) -> list[list[str]]:
    cleaned = _clean(text)
    delimiter = delimiter or sniff_delimiter(cleaned)
    rows = list(csv.reader(io.StringIO(cleaned), delimiter=delimiter))
    return [[cell.strip() for cell in row] for row in rows if any(cell.strip() for cell in row)]


def _header_field(cell: str) -> str | None:
    """Map one header cell to a field name, or None if it isn't recognized."""
    key = re.sub(r"[^a-z0-9/ ]", " ", cell.lower()).strip()
    key = re.sub(r"\s+", " ", key)
    if not key:
        return None
    for field_name, synonyms in _HEADER_SYNONYMS:
        if key in synonyms:
            return field_name
    return None


def detect_header_row(table: list[list[str]], max_scan: int = 10) -> int:
    """Find the real header row.

    Exports routinely carry a title line and a blank before the header
    ("FantasyPros — Half PPR Rankings"), so row 0 is not a safe assumption.
    Scores each candidate row by how many cells look like known headers.
    """
    best_index, best_score = 0, 0
    for index, row in enumerate(table[:max_scan]):
        score = sum(1 for cell in row if _header_field(cell))
        # Needs a name column to be a plausible header at all.
        has_name = any(_header_field(cell) == "name" for cell in row)
        if has_name and score > best_score:
            best_index, best_score = index, score
    return best_index


def guess_columns(header: list[str]) -> tuple[ColumnMapping, str]:
    """Guess the column mapping from a header row. Returns (mapping, confidence)."""
    assigned: dict[str, int] = {}
    for index, cell in enumerate(header):
        field_name = _header_field(cell)
        # First column wins a field, so a later "Rank" doesn't steal from an
        # earlier one.
        if field_name and field_name not in assigned:
            assigned[field_name] = index

    mapping = ColumnMapping(**{f: assigned.get(f) for f in _FIELDS})
    if mapping.overall_rank is None and mapping.position_rank is None:
        mapping = replace(mapping, overall_rank_from_row_order=True)

    confidence = "high" if mapping.name is not None and len(assigned) >= 2 else "low"
    return mapping, confidence


def split_pos_cell(value: str) -> tuple[str | None, int | None]:
    """Split a combined position cell: "WR3" -> ("WR", 3), "D/ST" -> ("DEF", None).

    FantasyPros-style exports pack the positional rank into the position
    column, which is the single most common reason a naive import produces a
    file with no positional ranks at all.
    """
    text = value.strip().upper()
    if not text:
        return None, None
    match = re.match(r"^([A-Z/]+)\s*(\d+)?$", text)
    if not match:
        return None, None
    return normalize_position(match.group(1)), int(match.group(2)) if match.group(2) else None


def normalize_position(value: str | None) -> str | None:
    if not value:
        return None
    return _POSITION_ALIASES.get(value.strip().upper())


def normalize_team(value: str | None) -> str | None:
    if not value:
        return None
    text = value.strip().upper()
    if not text or text in _NO_TEAM:
        return None
    return _TEAM_ALIASES.get(text, text)


def _to_int(value: str) -> int | None:
    """Ranks are ordinals, so a float ECR like "5.3" rounds to 5 -- the
    fractional part is the publisher's own averaging noise and carries no
    ordering information we don't already have.
    """
    text = value.strip().replace(",", "")
    if not text:
        return None
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    if not match:
        return None
    return round(float(match.group()))


def parse_rows(
    table: list[list[str]], header_row_index: int, mapping: ColumnMapping
) -> tuple[list[RawRankRow], list[str]]:
    warnings: list[str] = []
    rows: list[RawRankRow] = []
    saw_float_rank = False

    def cell(row: list[str], index: int | None) -> str:
        if index is None or index >= len(row):
            return ""
        return row[index]

    for offset, row in enumerate(table[header_row_index + 1 :]):
        name = cell(row, mapping.name).strip()
        if not name:
            continue

        position = normalize_position(cell(row, mapping.position))
        position_rank = _to_int(cell(row, mapping.position_rank))

        # A combined "WR3" cell only yields a positional rank when there isn't
        # a dedicated column; when both exist and disagree, keep the explicit
        # column and say so rather than silently picking one.
        combined_position, combined_rank = split_pos_cell(cell(row, mapping.position))
        if combined_position:
            position = combined_position
        if combined_rank is not None:
            if position_rank is None:
                position_rank = combined_rank
            elif position_rank != combined_rank:
                warnings.append(
                    f"{name}: position column says rank {combined_rank} but the positional "
                    f"rank column says {position_rank}; kept {position_rank}"
                )

        if mapping.single_position and position is None:
            position = mapping.single_position

        overall_raw = cell(row, mapping.overall_rank)
        if "." in overall_raw:
            saw_float_rank = True
        overall_rank = _to_int(overall_raw)
        if overall_rank is None and mapping.overall_rank_from_row_order:
            overall_rank = len(rows) + 1

        rows.append(
            RawRankRow(
                row_index=offset,
                name=name,
                position=position,
                team=normalize_team(cell(row, mapping.team)),
                overall_rank=overall_rank,
                position_rank=position_rank,
                tier=_to_int(cell(row, mapping.tier)),
            )
        )

    if saw_float_rank:
        warnings.append("Fractional ranks were rounded to whole numbers")
    return rows, warnings


def preview(text: str, mapping: ColumnMapping | None = None, sample_size: int = 10) -> ParsePreview:
    """Parse far enough to show the user what we think the columns mean.

    Deliberately a separate step from importing. A wrong guess produces a
    dataset that looks perfectly fine and quietly corrupts every comparison
    built on it -- the kind of thing you'd discover on draft day. One
    confirmation screen costs seconds.
    """
    delimiter = sniff_delimiter(text)
    table = read_table(text, delimiter)
    if not table:
        return ParsePreview(
            delimiter=delimiter,
            header_row_index=0,
            columns=[],
            mapping=ColumnMapping(),
            confidence="low",
            sample_rows=[],
            row_count=0,
            warnings=["The file has no rows"],
        )

    header_row_index = detect_header_row(table)
    header = table[header_row_index]
    if mapping is None:
        mapping, confidence = guess_columns(header)
    else:
        confidence = "high"

    rows, warnings = parse_rows(table, header_row_index, mapping)
    if mapping.name is None:
        warnings.append("No player-name column was recognized -- pick one below")

    return ParsePreview(
        delimiter=delimiter,
        header_row_index=header_row_index,
        columns=header,
        mapping=mapping,
        confidence=confidence,
        sample_rows=rows[:sample_size],
        row_count=len(rows),
        warnings=warnings,
    )
