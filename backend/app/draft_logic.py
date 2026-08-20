"""Pure snake-draft math -- no DB, no I/O. Slots are 1-based (1..num_teams),
rounds are 1-based, pick_number is the 1-based overall pick across the whole draft.

Snake order: odd rounds go 1..num_teams, even rounds go num_teams..1.
"""


def pick_to_round_and_slot(pick_number: int, num_teams: int) -> tuple[int, int]:
    round_ = (pick_number - 1) // num_teams + 1
    position_in_round = (pick_number - 1) % num_teams

    if round_ % 2 == 1:
        slot = position_in_round + 1
    else:
        slot = num_teams - position_in_round

    return round_, slot


def round_and_slot_to_pick(round_: int, slot: int, num_teams: int) -> int:
    if round_ % 2 == 1:
        position_in_round = slot - 1
    else:
        position_in_round = num_teams - slot

    return (round_ - 1) * num_teams + position_in_round + 1


def total_picks(num_teams: int, num_rounds: int) -> int:
    return num_teams * num_rounds
