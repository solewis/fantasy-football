"""Splitting a document into retrievable passages.

Pure text in, chunks out -- no DB, no I/O, in the same spirit as
app/draft_logic.py, so the sizing rules can be tested directly.

Paragraphs are the unit. A chunk is one or more whole paragraphs, and a
paragraph is never split across chunks unless it's oversized on its own. That
matters more here than hitting an exact token count: these chunks get quoted
back to you at pick time, and an argument cut in half mid-sentence is worse
than one that ran 200 characters long.
"""

import re
from dataclasses import dataclass

# Roughly 250-350 words. Big enough to carry a full take on a player (the
# thing being retrieved is an argument, not a fact), small enough that pulling
# a dozen for the players on the board stays well inside a prompt.
TARGET_CHARS = 1600
# Paragraphs longer than this are split on sentence boundaries rather than
# shipped whole -- a transcript with no paragraph breaks would otherwise
# produce one chunk for the entire document.
MAX_CHARS = 2600
# Below this a chunk is merged into the next one instead of standing alone. A
# stray heading or one-line aside carries no argument by itself, and retrieving
# it tells you only that a name was said.
MIN_CHARS = 200

_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")
# Split after ., ! or ? followed by whitespace. Deliberately naive: the failure
# mode is an over-eager split inside "Mr. Smith", which costs a slightly odd
# chunk boundary and nothing else.
_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


@dataclass(frozen=True)
class Chunk:
    text: str
    char_start: int


def _paragraphs(text: str) -> list[tuple[str, int]]:
    """(paragraph, offset-into-text) pairs, blank paragraphs dropped.

    Offsets are tracked through the split rather than recovered afterwards with
    str.find, which would return the wrong position for a paragraph that
    repeats verbatim (a section heading, a recurring "Verdict:" line).
    """
    result: list[tuple[str, int]] = []
    cursor = 0
    for part in _PARAGRAPH_BREAK.split(text):
        start = cursor
        cursor += len(part)
        match = _PARAGRAPH_BREAK.match(text, cursor)
        if match:
            cursor = match.end()
        stripped = part.strip()
        if stripped:
            result.append((stripped, start + len(part) - len(part.lstrip())))
    return result


def _sentence_spans(paragraph: str) -> list[tuple[str, int]]:
    """(sentence, offset-within-paragraph) pairs.

    Offsets are walked forward with a running position rather than looked up
    from the start, so a sentence repeated inside one paragraph still gets the
    position it actually occupies.
    """
    spans: list[tuple[str, int]] = []
    position = 0
    for sentence in _SENTENCE_END.split(paragraph):
        index = paragraph.index(sentence, position)
        spans.append((sentence, index))
        position = index + len(sentence)
    return spans


def _split_oversized(paragraph: str, offset: int) -> list[tuple[str, int]]:
    """Break a too-long paragraph on sentence boundaries into TARGET_CHARS pieces."""
    pieces: list[tuple[str, int]] = []
    buffer = ""
    buffer_start: int | None = None
    for sentence, index in _sentence_spans(paragraph):
        if buffer and len(buffer) + 1 + len(sentence) > TARGET_CHARS:
            assert buffer_start is not None
            pieces.append((buffer, offset + buffer_start))
            buffer, buffer_start = sentence, index
        else:
            if buffer_start is None:
                buffer_start = index
            buffer = f"{buffer} {sentence}" if buffer else sentence
    if buffer and buffer_start is not None:
        pieces.append((buffer, offset + buffer_start))
    return pieces


def chunk_text(text: str) -> list[Chunk]:
    """Split a document into chunks, accumulating paragraphs up to TARGET_CHARS.

    A trailing chunk shorter than MIN_CHARS is folded back into the previous
    one rather than left to stand alone -- the last paragraph of an article is
    often a one-line sign-off.
    """
    units: list[tuple[str, int]] = []
    for paragraph, offset in _paragraphs(text):
        if len(paragraph) > MAX_CHARS:
            units.extend(_split_oversized(paragraph, offset))
        else:
            units.append((paragraph, offset))

    chunks: list[Chunk] = []
    buffer: list[str] = []
    buffer_start = 0
    for paragraph, offset in units:
        if not buffer:
            buffer_start = offset
        candidate = "\n\n".join([*buffer, paragraph])
        if buffer and len(candidate) > TARGET_CHARS:
            chunks.append(Chunk(text="\n\n".join(buffer), char_start=buffer_start))
            buffer = [paragraph]
            buffer_start = offset
        else:
            buffer.append(paragraph)

    if buffer:
        tail = "\n\n".join(buffer)
        if chunks and len(tail) < MIN_CHARS:
            previous = chunks.pop()
            chunks.append(Chunk(text=f"{previous.text}\n\n{tail}", char_start=previous.char_start))
        else:
            chunks.append(Chunk(text=tail, char_start=buffer_start))

    return chunks
