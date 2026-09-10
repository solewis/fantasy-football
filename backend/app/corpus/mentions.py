"""Finding the players named in a passage of prose.

This is a scan against the known player list, not entity recognition and not a
model call. That's the whole trick: the set of names worth finding is closed
and about 1,200 long, so sliding a window over the tokens and looking each one
up in a dict is exact, instant, free, and testable -- everything a fuzzy or
generative approach here would not be.

The scanner deliberately finds *fewer* mentions than a human would rather than
guess. A missed mention costs one passage of recall at pick time; a wrong one
puts another player's take under a name and quietly corrupts the advice.
"""

import re
import unicodedata
from dataclasses import dataclass, field

from app.matching.candidates import fantasy_players
from app.matching.normalize import STRIP_TOKENS, normalize_name

FULL_NAME = "full_name"
SURNAME = "surname"
ALIAS = "alias"

# Longest normalized player name worth scanning for, in tokens
# ("san francisco 49ers" is 3). Caps the window loop regardless of what junk
# is in the player list.
MAX_NAME_TOKENS = 4

_DST_LABEL = re.compile(r"\bd/st\b", re.IGNORECASE)

# Surnames that are also ordinary English words. A capital letter is what tells
# a proper noun from a common one, and at the start of a sentence every word
# has one -- so "Love him at that price" reads exactly like a Jordan Love
# sighting. These are the names where that collision actually happens; for
# them, a sentence-initial hit is not allowed to create a mention on its own
# (see scan_chunk). Not exhaustive, and doesn't need to be: a name missing from
# here costs one occasionally-irrelevant passage, not a wrong attribution.
COMMON_WORD_SURNAMES = frozenset(
    {
        "banks",
        "bell",
        "black",
        "brown",
        "chase",
        "cook",
        "cross",
        "dean",
        "field",
        "fields",
        "flowers",
        "gray",
        "green",
        "hall",
        "hill",
        "judge",
        "king",
        "land",
        "lane",
        "long",
        "love",
        "moss",
        "noble",
        "park",
        "price",
        "reed",
        "rice",
        "rivers",
        "rush",
        "sharp",
        "short",
        "small",
        "stone",
        "strong",
        "swift",
        "ward",
        "waters",
        "west",
        "white",
        "wise",
        "wood",
        "young",
    }
)

# A sentence boundary immediately before a token: nothing at all (start of the
# chunk), a paragraph break, or terminal punctuation and whitespace.
_SENTENCE_START = re.compile(r"(?:^|[.!?]['\")\]]?\s+|\n\s*)$")


@dataclass(frozen=True)
class Mention:
    normalized_name: str
    source_name_raw: str
    detected_by: str
    occurrences: int


@dataclass
class NameIndex:
    """Normalized player names to scan for, plus the surname lookup.

    `by_name` maps a normalized name to itself rather than to a player id --
    mentions are stored platform-free (see ChunkMention) and resolved on read,
    so the scanner never needs to know a player id at all.
    """

    by_name: set[str] = field(default_factory=set)
    # Names that came from the alias list rather than a platform player list,
    # so a hit can be reported as what it is.
    aliases: set[str] = field(default_factory=set)
    # Last token of a full name -> the full names ending in it. Ambiguity is
    # kept rather than resolved here; the scanner needs to see it.
    by_surname: dict[str, set[str]] = field(default_factory=dict)
    max_tokens: int = 2


def build_name_index(platform_players: list[dict], aliases: list[str] | None = None) -> NameIndex:
    """Build the scannable name set from a platform's player list.

    Filtered to fantasy positions for the same reason app/matching does it: a
    practice-squad long snapper sharing a surname with a WR is pure downside.

    `aliases` are extra normalized names to scan for -- the nicknames fantasy
    writers actually use ("CMC", "JSN"), which appear in no platform's player
    list and so can never be detected by the window scan alone. They come from
    NameMapping rows under the corpus source type, which is what lets you teach
    the scanner one by hand and rescan.
    """
    index = NameIndex()
    for player in fantasy_players(platform_players):
        normalized = normalize_name(player["name"])
        if not normalized:
            continue
        index.by_name.add(normalized)
        tokens = normalized.split()
        index.max_tokens = max(index.max_tokens, min(len(tokens), MAX_NAME_TOKENS))
        index.by_surname.setdefault(tokens[-1], set()).add(normalized)

    for alias in aliases or []:
        if alias:
            index.by_name.add(alias)
            index.aliases.add(alias)
            index.max_tokens = max(index.max_tokens, min(len(alias.split()), MAX_NAME_TOKENS))

    return index


@dataclass(frozen=True)
class Token:
    text: str
    start: int
    end: int
    capitalized: bool


def tokenize(text: str) -> list[Token]:
    """Normalized tokens with their spans in the original text.

    Applies the same character rules as matching.normalize_name -- accent
    folding, D.J. -> dj, hyphens as separators, generational suffixes dropped
    -- so a token run compares directly against a normalized player name. The
    span is kept because the raw spelling is what gets stored on the mention,
    and because capitalization is evidence (see scan_document).
    """
    # Blanked rather than deleted so every offset below still points at the
    # original string.
    text = _DST_LABEL.sub(lambda m: " " * len(m.group()), text)

    tokens: list[Token] = []
    buffer: list[str] = []
    start = 0
    raw_upper = False

    def flush(end: int) -> None:
        nonlocal buffer, raw_upper
        if buffer:
            word = "".join(buffer)
            if word not in STRIP_TOKENS:
                tokens.append(Token(word, start, end, raw_upper))
            buffer = []
            raw_upper = False

    for i, char in enumerate(text):
        folded = unicodedata.normalize("NFKD", char).encode("ascii", "ignore").decode("ascii")
        # Dropped outright, never a separator: "D.J." has to become one token.
        if folded in {".", "'"}:
            continue
        lowered = folded.lower()
        if lowered.isalnum() and len(folded) == 1:
            if not buffer:
                start = i
                raw_upper = char.isupper()
            buffer.append(lowered)
        else:
            flush(i)
    flush(len(text))

    return tokens


def _count_windows(
    tokens: list[Token], index: NameIndex
) -> tuple[dict[str, list[tuple[int, int]]], list[bool]]:
    """Full-name hits, plus the mask of which tokens they used up.

    Longest window first, and a matched token is consumed. Longest-first
    matters for names that contain other names -- without it "san francisco
    49ers" would also register whatever two-token name sits inside it.

    The mask is returned rather than kept private because the surname pass has
    to skip it: the "McCaffrey" inside a matched "Christian McCaffrey" is the
    same reference, not a second one.

    Single-token windows are matched only against aliases. Letting a bare token
    match a real player name would make every occurrence of the word "love" a
    Jordan Love sighting -- which is exactly what the surname pass exists to
    handle carefully.
    """
    consumed = [False] * len(tokens)
    hits: dict[str, list[tuple[int, int]]] = {}

    for size in range(min(index.max_tokens, MAX_NAME_TOKENS), 0, -1):
        for i in range(len(tokens) - size + 1):
            window = tokens[i : i + size]
            if any(consumed[i + offset] for offset in range(size)):
                continue
            candidate = " ".join(token.text for token in window)
            if candidate not in index.by_name:
                continue
            if size == 1 and candidate not in index.aliases:
                continue
            hits.setdefault(candidate, []).append((window[0].start, window[-1].end))
            for offset in range(size):
                consumed[i + offset] = True

    return hits, consumed


def _starts_a_sentence(text: str, start: int) -> bool:
    return bool(_SENTENCE_START.search(text[:start]))


def scan_chunk(text: str, index: NameIndex, known_in_document: set[str]) -> list[Mention]:
    """Every player named in one chunk.

    Two passes. The first matches full names against the index. The second
    picks up bare surnames ("Jefferson had a quiet week"), which are how
    writers refer to a player after introducing them -- but *only* for players
    whose full name is already known (from an earlier chunk, or from the first
    pass over this one), and only where the surname is capitalized in the
    source.

    Both restrictions exist to keep the second pass from firing on ordinary
    English. Without the name-scoping and the capital letter, an article that
    never mentions Jordan Love would still collect a mention of him every time
    the writer used the word "love".

    That leaves one hole, which the third rule closes: at the start of a
    sentence every word is capitalized, so "Love him at that price" looks
    identical to a real surname. For the names where that collision is
    plausible (COMMON_WORD_SURNAMES), a sentence-initial hit can only add to a
    mention that other evidence in the same chunk already established -- it
    never creates one. A chunk whose sole claim to a player is a sentence
    starting with "Chase" is not a chunk about Ja'Marr Chase.
    """
    tokens = tokenize(text)
    hits, consumed = _count_windows(tokens, index)

    resolvable = known_in_document | set(hits)
    weak: dict[str, list[tuple[int, int]]] = {}
    for token, already_matched in zip(tokens, consumed, strict=True):
        if already_matched or not token.capitalized:
            continue
        candidates = index.by_surname.get(token.text, set()) & resolvable
        # Ambiguous even within this document (two Browns discussed in one
        # article) -- attributing it to either is a coin flip, so neither.
        if len(candidates) != 1:
            continue
        full_name = next(iter(candidates))
        if token.text in COMMON_WORD_SURNAMES and _starts_a_sentence(text, token.start):
            weak.setdefault(full_name, []).append((token.start, token.end))
        else:
            hits.setdefault(full_name, []).append((token.start, token.end))

    for full_name, spans in weak.items():
        if full_name in hits:
            hits[full_name].extend(spans)

    mentions: list[Mention] = []
    for normalized, spans in hits.items():
        spans.sort()
        first_start, first_end = spans[0]
        if normalized in index.aliases:
            detected_by = ALIAS
        elif normalized in known_in_document and text[first_start:first_end].count(" ") == 0:
            detected_by = SURNAME
        else:
            detected_by = FULL_NAME
        mentions.append(
            Mention(
                normalized_name=normalized,
                source_name_raw=text[first_start:first_end],
                detected_by=detected_by,
                occurrences=len(spans),
            )
        )

    return mentions


def scan_document(chunk_texts: list[str], index: NameIndex) -> list[list[Mention]]:
    """Scan every chunk of one document, carrying forward the names seen so far.

    Document-scoped state is the point: the surname pass can only resolve
    "Jefferson" once "Justin Jefferson" has been named, and that introduction
    is usually in an earlier chunk than the discussion.
    """
    known: set[str] = set()
    results: list[list[Mention]] = []
    for text in chunk_texts:
        mentions = scan_chunk(text, index, known)
        known.update(m.normalized_name for m in mentions)
        results.append(mentions)
    return results
