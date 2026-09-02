/** Bucketing a per-source rank delta for display.
 *
 * delta = source_rank - slot. Negative means the source is *higher* on the
 * player than the slot you're filling (they'd have taken them sooner);
 * positive means the source rates them worse than this slot.
 *
 * "Higher rank" is ambiguous in English -- rank 3 is a higher rank but a lower
 * number -- so the signed delta is the source of truth everywhere and the
 * bucket is only ever used to pick a colour.
 */

export type DeltaArm = 'none' | 'value' | 'behind'

/** 0 = agreement, 1 = barely, 5 = as far apart as the scale goes. Intensity
 * always runs light to dark, in both themes: a small disagreement is a pale
 * chip, a big one is a saturated one. */
export type DeltaLevel = 0 | 1 | 2 | 3 | 4 | 5

export interface DeltaBucket {
  arm: DeltaArm
  level: DeltaLevel
  /** Whether the source has an opinion at all. */
  missing: boolean
}

/** Upper bound of each level, so a delta at or below `bounds[i]` is level i+1.
 * Anything past the last bound is the top level. */
export type DeltaBounds = readonly [number, number, number, number]

/** Comparing a player's ADP or your own rank against the pick on the clock.
 * Absolute rather than scaled: a 12-pick gap reads the same whether it turns
 * up early or late, and this is the scale a drafter already has in their head.
 */
export const PICK_BOUNDS: DeltaBounds = [2, 5, 8, 11]

/** Building a list, where you are filling slot N of your own ordering.
 * Scaled, because +/-2 is a real disagreement at WR3 and noise at pick 84. */
export function boundsForSlot(slot: number): DeltaBounds {
  const unit = Math.max(1, Math.round(slot * 0.04))
  return [unit, unit * 3, unit * 6, unit * 10]
}

export function rankDelta(
  sourceRank: number | null,
  slot: number,
): number | null {
  return sourceRank === null ? null : sourceRank - slot
}

export function deltaBucket(
  delta: number | null,
  bounds: DeltaBounds,
): DeltaBucket {
  if (delta === null) return { arm: 'none', level: 0, missing: true }
  if (delta === 0) return { arm: 'none', level: 0, missing: false }

  const magnitude = Math.abs(delta)
  const arm: DeltaArm = delta < 0 ? 'value' : 'behind'
  const index = bounds.findIndex((bound) => magnitude <= bound)
  const level = (index === -1 ? 5 : index + 1) as DeltaLevel
  return { arm, level, missing: false }
}

/** '+3' | '-1' | '0' | '—'. An ASCII hyphen deliberately, not a minus sign --
 * an invisible-character mismatch between component and test is a bad
 * afternoon. */
export function formatDelta(delta: number | null): string {
  if (delta === null) return '—'
  if (delta === 0) return '0'
  return delta > 0 ? `+${delta}` : `${delta}`
}

/** The accessible description, so a chip never conveys its meaning by colour
 * alone. */
export function describeDelta(
  sourceLabel: string,
  sourceRank: number | null,
  slot: number,
  slotLabel: string,
  beyondDepth = false,
): string {
  if (sourceRank === null) {
    return beyondDepth
      ? `${sourceLabel} doesn't rank this deep`
      : `${sourceLabel} doesn't rank this player`
  }
  const delta = sourceRank - slot
  if (delta === 0) return `${sourceLabel} also has them at ${slotLabel}`
  if (delta < 0) {
    return `${sourceLabel} has them ${Math.abs(delta)} higher, at ${sourceRank}`
  }
  return `${sourceLabel} has them ${delta} lower, at ${sourceRank}`
}
