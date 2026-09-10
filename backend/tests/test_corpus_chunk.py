from app.corpus.chunk import MAX_CHARS, MIN_CHARS, TARGET_CHARS, chunk_text


def paragraph(word: str, length: int) -> str:
    """A paragraph of roughly `length` characters, built from one repeated word."""
    unit = f"{word} "
    return (unit * (length // len(unit) + 1))[:length].strip()


def test_empty_text_produces_nothing():
    assert chunk_text("") == []
    assert chunk_text("\n\n   \n\n") == []


def test_short_document_is_one_chunk():
    chunks = chunk_text("Bijan is the RB1.\n\nTake him at 1.02.")
    assert len(chunks) == 1
    assert chunks[0].text == "Bijan is the RB1.\n\nTake him at 1.02."
    assert chunks[0].char_start == 0


def test_char_start_points_at_the_text():
    source = "\n\n  Leading blanks.\n\nSecond paragraph."
    chunk = chunk_text(source)[0]
    assert source[chunk.char_start :].startswith("Leading blanks.")


def test_repeated_paragraph_gets_distinct_offsets():
    # Two identical paragraphs: an offset recovered with str.find would give
    # both the same position.
    body = paragraph("verdict", TARGET_CHARS)
    chunks = chunk_text(f"{body}\n\n{body}")
    assert len(chunks) == 2
    assert chunks[0].char_start != chunks[1].char_start
    assert chunks[1].char_start == len(body) + 2


def test_paragraphs_accumulate_up_to_target():
    small = paragraph("take", 400)
    chunks = chunk_text("\n\n".join([small] * 8))
    assert len(chunks) > 1
    for chunk in chunks:
        assert len(chunk.text) <= TARGET_CHARS + len(small)


def test_paragraph_boundaries_are_preserved():
    small = paragraph("take", 400)
    chunks = chunk_text("\n\n".join([small] * 8))
    for chunk in chunks:
        for part in chunk.text.split("\n\n"):
            assert part == small


def test_oversized_paragraph_splits_on_sentences():
    sentence = "He is a fine flex play in deeper leagues. "
    huge = (sentence * (MAX_CHARS // len(sentence) + 4)).strip()
    chunks = chunk_text(huge)
    assert len(chunks) > 1
    for chunk in chunks:
        assert chunk.text.endswith(".")


def test_short_tail_is_folded_into_the_previous_chunk():
    body = paragraph("analysis", TARGET_CHARS)
    chunks = chunk_text(f"{body}\n\nThanks for reading.")
    assert len(chunks) == 1
    assert chunks[0].text.endswith("Thanks for reading.")


def test_short_standalone_document_is_kept():
    # The fold-the-tail rule must not delete a document that is only a tail.
    chunks = chunk_text("Thanks for reading.")
    assert len(chunks) == 1
    assert len(chunks[0].text) < MIN_CHARS
