/** Bucketing a per-source rank delta for display.
 *
 * delta = source_rank - slot. Negative means the source is *higher* on the
 * player than the slot you're filling (they'd have taken them sooner);
 * positive means the source rates them worse than this slot.
 *
 * "Higher rank" is ambiguous in English -- rank 3 is a higher rank but a lower
 * number -- so the signed delta is the source of truth everywhere and the
 * bucket name is only ever used to pick a colour.
 */

export type DeltaBucket =
  | 'missing'
  | 'neutral'
  | 'value-slight'
  | 'value-moderate'
  | 'value-strong'
  | 'behind-slight'
  | 'behind-moderate'
  | 'behind-strong'

export type DeltaArm = 'none' | 'value' | 'behind'

export interface DeltaThresholds {
  /** |delta| at or below this is a slight disagreement. */
  slight: number
  /** |delta| at or below this is moderate; beyond it is strong. */
  moderate: number
}

/** Thresholds scale with the slot.
 *
 * A fixed band is wrong at one end or the other: +/-2 is a real disagreement at
 * WR3 and pure noise at overall pick 84. The floors keep the top of a list
 * strict -- at slot 1 a source saying WR3 reads as a disagreement, which is
 * what you'd expect from "three sources have him WR1 and one has him WR3".
 */
export function thresholdsAt(slot: number): DeltaThresholds {
  return {
    slight: Math.max(2, Math.round(slot * 0.05)),
    moderate: Math.max(5, Math.round(slot * 0.15)),
  }
}

export function rankDelta(
  sourceRank: number | null,
  slot: number,
): number | null {
  return sourceRank === null ? null : sourceRank - slot
}

export function deltaBucket(
  delta: number | null,
  thresholds: DeltaThresholds,
): DeltaBucket {
  if (delta === null) return 'missing'
  if (delta === 0) return 'neutral'

  const magnitude = Math.abs(delta)
  const arm = delta < 0 ? 'value' : 'behind'
  if (magnitude <= thresholds.slight) return `${arm}-slight`
  if (magnitude <= thresholds.moderate) return `${arm}-moderate`
  return `${arm}-strong`
}

export function armOf(bucket: DeltaBucket): DeltaArm {
  if (bucket === 'missing' || bucket === 'neutral') return 'none'
  return bucket.startsWith('value') ? 'value' : 'behind'
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
