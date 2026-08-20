import pytest

from app.draft_logic import pick_to_round_and_slot, round_and_slot_to_pick, total_picks


@pytest.mark.parametrize(
    "pick_number,expected",
    [
        (1, (1, 1)),
        (5, (1, 5)),
        (10, (1, 10)),
        (11, (2, 10)),
        (15, (2, 6)),
        (20, (2, 1)),
        (21, (3, 1)),
        (30, (3, 10)),
        (31, (4, 10)),
        (40, (4, 1)),
    ],
)
def test_pick_to_round_and_slot_10_teams(pick_number, expected):
    assert pick_to_round_and_slot(pick_number, num_teams=10) == expected


def test_pick_to_round_and_slot_small_league():
    # 4-team league: round 1 -> 1,2,3,4 ; round 2 -> 4,3,2,1
    assert pick_to_round_and_slot(1, num_teams=4) == (1, 1)
    assert pick_to_round_and_slot(4, num_teams=4) == (1, 4)
    assert pick_to_round_and_slot(5, num_teams=4) == (2, 4)
    assert pick_to_round_and_slot(8, num_teams=4) == (2, 1)
    assert pick_to_round_and_slot(9, num_teams=4) == (3, 1)


@pytest.mark.parametrize("num_teams", [4, 8, 10, 12, 14])
@pytest.mark.parametrize("num_rounds", [1, 2, 5, 15])
def test_pick_and_round_slot_are_inverses(num_teams, num_rounds):
    for pick_number in range(1, total_picks(num_teams, num_rounds) + 1):
        round_, slot = pick_to_round_and_slot(pick_number, num_teams)
        assert round_and_slot_to_pick(round_, slot, num_teams) == pick_number


def test_round_and_slot_to_pick_matches_known_values():
    assert round_and_slot_to_pick(1, 1, num_teams=10) == 1
    assert round_and_slot_to_pick(1, 10, num_teams=10) == 10
    assert round_and_slot_to_pick(2, 10, num_teams=10) == 11
    assert round_and_slot_to_pick(2, 1, num_teams=10) == 20
    assert round_and_slot_to_pick(3, 1, num_teams=10) == 21


def test_total_picks():
    assert total_picks(num_teams=10, num_rounds=14) == 140
    assert total_picks(num_teams=12, num_rounds=16) == 192
