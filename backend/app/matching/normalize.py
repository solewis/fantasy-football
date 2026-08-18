import re
import unicodedata

# Suffixes/labels that shouldn't affect matching: generational suffixes on
# player names, and defense/special-teams labels on DST entries.
_STRIP_TOKENS = {"jr", "sr", "ii", "iii", "iv", "v", "dst", "def"}


def normalize_name(name: str) -> str:
    """Reduce a free-text player/DST name to a comparable key.

    Handles: case, accents, punctuation (D.J. -> dj, Le'Veon -> leveon),
    hyphens as word separators (Ray-Ray -> ray ray), generational suffixes
    (Jr./Sr./II/III), and "D/ST"-style defense labels.
    """
    text = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"\bd/st\b", " ", text)
    text = text.replace("-", " ")
    text = re.sub(r"[.']", "", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)

    tokens = [token for token in text.split() if token not in _STRIP_TOKENS]
    return " ".join(tokens)
