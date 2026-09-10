/** Snake-draft pick numbering, mirroring the backend's app/draft_logic.py.
 *
 * Odd rounds run slot 1..n; even rounds reverse. The board keeps a team in the
 * same column all the way down, so in even rounds the leftmost column is the
 * *last* pick of that round, not the first.
 */

/** Where this team picks within the round (1-based). */
export function pickInRound(
  round: number,
  slot: number,
  numTeams: number,
): number {
  return round % 2 === 1 ? slot : numTeams - slot + 1
}

/** The overall pick number across the whole draft (1-based). */
export function overallPick(
  round: number,
  slot: number,
  numTeams: number,
): number {
  return (round - 1) * numTeams + pickInRound(round, slot, numTeams)
}

/** "2.10 (20)" -- the round's own numbering, then the overall pick. */
export function pickLabel(
  round: number,
  slot: number,
  numTeams: number,
): string {
  return `${round}.${pickInRound(round, slot, numTeams)} (${overallPick(round, slot, numTeams)})`
}
