export interface RosterSlotTemplate {
  label: string
  eligible: readonly string[]
}

const ELIGIBILITY_BY_CODE: Record<string, readonly string[]> = {
  QB: ['QB'],
  RB: ['RB'],
  WR: ['WR'],
  TE: ['TE'],
  K: ['K'],
  DEF: ['DEF'],
  FLEX: ['RB', 'WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
}

/** Turns Sleeper's own roster_positions array (from a League) into the
 * starter-slot template DraftRosterPanel renders -- bench ("BN") entries are
 * excluded, since those are rendered as a separate open-ended overflow list
 * instead. Unknown position codes (e.g. IDP slots this app doesn't support
 * yet) fall back to a single-eligibility slot for that exact code, rather
 * than being dropped or crashing.
 */
export function slotsFromRosterPositions(
  rosterPositions: readonly string[],
): RosterSlotTemplate[] {
  return rosterPositions
    .filter((code) => code !== 'BN')
    .map((code) => ({
      label: code,
      eligible: ELIGIBILITY_BY_CODE[code] ?? [code],
    }))
}
