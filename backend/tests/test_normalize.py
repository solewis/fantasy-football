import pytest

from app.matching.normalize import normalize_name


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("Patrick Mahomes II", "patrick mahomes"),
        ("Odell Beckham Jr.", "odell beckham"),
        ("Marvin Harrison Sr.", "marvin harrison"),
        ("D.J. Moore", "dj moore"),
        ("A.J. Brown", "aj brown"),
        ("AJ Brown", "aj brown"),
        ("Le'Veon Bell", "leveon bell"),
        ("Ray-Ray McCloud", "ray ray mccloud"),
        ("49ers D/ST", "49ers"),
        ("  Extra   Space  ", "extra space"),
    ],
)
def test_normalize_name(raw, expected):
    assert normalize_name(raw) == expected
