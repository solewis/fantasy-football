from app.corpus.mentions import (
    ALIAS,
    FULL_NAME,
    SURNAME,
    build_name_index,
    scan_chunk,
    scan_document,
    tokenize,
)

PLAYERS = [
    {"platform_player_id": "1", "name": "Justin Jefferson", "position": "WR"},
    {"platform_player_id": "2", "name": "Jordan Love", "position": "QB"},
    {"platform_player_id": "3", "name": "Marvin Harrison Jr.", "position": "WR"},
    {"platform_player_id": "4", "name": "Christian McCaffrey", "position": "RB"},
    {"platform_player_id": "5", "name": "D.J. Moore", "position": "WR"},
    {"platform_player_id": "6", "name": "San Francisco 49ers", "position": "DEF"},
    {"platform_player_id": "7", "name": "Van Jefferson", "position": "WR"},
    {"platform_player_id": "8", "name": "Amon-Ra St. Brown", "position": "WR"},
    # Fantasy-irrelevant position: must never be scanned for.
    {"platform_player_id": "9", "name": "Zack Baun", "position": "LB"},
]


def index():
    return build_name_index(PLAYERS)


def names(mentions):
    return {m.normalized_name for m in mentions}


def by_name(mentions):
    return {m.normalized_name: m for m in mentions}


def test_tokenize_matches_normalize_rules():
    tokens = [t.text for t in tokenize("D.J. Moore and Amon-Ra St. Brown Jr.")]
    assert tokens == ["dj", "moore", "and", "amon", "ra", "st", "brown"]


def test_tokenize_tracks_spans_and_capitalization():
    text = "we love Jordan Love"
    spans = {t.text: (t.start, t.capitalized) for t in tokenize(text)}
    assert spans["we"] == (0, False)
    # Both the verb and the surname normalize to "love"; only the span and the
    # capital letter tell them apart, which is what the surname pass leans on.
    assert spans["love"][1] is True


def test_finds_full_names():
    mentions = scan_chunk("Justin Jefferson is the WR1 over D.J. Moore.", index(), set())
    assert names(mentions) == {"justin jefferson", "dj moore"}
    assert all(m.detected_by == FULL_NAME for m in mentions)


def test_ignores_non_fantasy_positions():
    assert scan_chunk("Zack Baun led the team in tackles.", index(), set()) == []


def test_generational_suffix_is_ignored():
    mentions = scan_chunk("Marvin Harrison Jr. broke out.", index(), set())
    assert names(mentions) == {"marvin harrison"}


def test_longest_window_wins():
    mentions = scan_chunk("The San Francisco 49ers defense is elite.", index(), set())
    assert names(mentions) == {"san francisco 49ers"}


def test_counts_occurrences():
    text = "Christian McCaffrey again. Christian McCaffrey is the RB1."
    assert by_name(scan_chunk(text, index(), set()))["christian mccaffrey"].occurrences == 2


def test_surname_resolves_after_full_name_in_same_chunk():
    text = "Jordan Love took a leap. Love finished as a top-five QB."
    mention = by_name(scan_chunk(text, index(), set()))["jordan love"]
    assert mention.occurrences == 2
    assert mention.detected_by == FULL_NAME


def test_lowercase_common_word_is_not_a_surname():
    # "love" the verb, in a document that has already named Jordan Love.
    mentions = scan_chunk("I love this pick.", index(), {"jordan love"})
    assert mentions == []


def test_surname_needs_a_known_full_name():
    # Deliberately not a COMMON_WORD_SURNAMES name -- this is testing the
    # document-scoping rule on its own, not the sentence-start one.
    assert scan_chunk("McCaffrey is going to be great.", index(), set()) == []
    mentions = scan_chunk("McCaffrey is going to be great.", index(), {"christian mccaffrey"})
    assert by_name(mentions)["christian mccaffrey"].detected_by == SURNAME


def test_ambiguous_surname_is_dropped():
    # Two Jeffersons both known: attributing the bare surname is a coin flip.
    known = {"justin jefferson", "van jefferson"}
    assert scan_chunk("Jefferson is a league winner.", index(), known) == []
    # ...but unambiguous when only one of them is in play.
    mentions = scan_chunk("Jefferson is a league winner.", index(), {"justin jefferson"})
    assert names(mentions) == {"justin jefferson"}


def test_aliases_are_scanned_and_labelled():
    aliased = build_name_index(PLAYERS, aliases=["cmc"])
    mentions = scan_chunk("CMC is back to full health.", aliased, set())
    assert by_name(mentions)["cmc"].detected_by == ALIAS


def test_scan_document_carries_names_across_chunks():
    chunks = [
        "Justin Jefferson is the headliner.",
        "Jefferson has finished as a WR1 three times.",
    ]
    first, second = scan_document(chunks, index())
    assert names(first) == {"justin jefferson"}
    assert by_name(second)["justin jefferson"].detected_by == SURNAME


def test_raw_spelling_is_preserved():
    mentions = scan_chunk("Amon-Ra St. Brown dominated.", index(), set())
    assert by_name(mentions)["amon ra st brown"].source_name_raw == "Amon-Ra St. Brown"


def test_sentence_initial_common_word_does_not_create_a_mention():
    # "Love him at that price" -- capitalized only because it opens a sentence.
    assert scan_chunk("Love him at that price.", index(), {"jordan love"}) == []


def test_sentence_initial_common_word_still_counts_alongside_real_evidence():
    text = "Jordan Love is my QB5. Love is the pick at that price."
    mention = by_name(scan_chunk(text, index(), set()))["jordan love"]
    assert mention.occurrences == 2


def test_mid_sentence_common_word_surname_is_trusted():
    mentions = scan_chunk("I am buying Love at that price.", index(), {"jordan love"})
    assert names(mentions) == {"jordan love"}


def test_uncommon_surname_still_works_at_a_sentence_start():
    mentions = scan_chunk("Jefferson stays at WR1.", index(), {"justin jefferson"})
    assert names(mentions) == {"justin jefferson"}
