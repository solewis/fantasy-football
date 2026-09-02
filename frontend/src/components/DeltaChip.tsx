import {
  deltaBucket,
  describeDelta,
  formatDelta,
  rankDelta,
  type DeltaBounds,
} from '../lib/deltaBuckets'
import './delta.css'

interface DeltaChipProps {
  /** null when this source doesn't rank the player. */
  sourceRank: number | null
  slot: number
  /** Where the intensity steps fall. The draft pool and the list builder use
   * different scales -- see PICK_BOUNDS and boundsForSlot. */
  bounds: DeltaBounds
  sourceLabel: string
  slotLabel: string
  /** True when the source simply doesn't publish this deep -- a different fact
   * from leaving the player off, and at slot 200 everything would otherwise
   * read as unanimous disagreement. */
  beyondDepth?: boolean
}

/** One source's opinion about one candidate, at the slot being filled.
 *
 * The signed number is always printed, so colour is never the only channel --
 * which is also what makes the palest steps' sub-3:1 contrast acceptable.
 */
export function DeltaChip({
  sourceRank,
  slot,
  bounds,
  sourceLabel,
  slotLabel,
  beyondDepth = false,
}: DeltaChipProps) {
  const delta = rankDelta(sourceRank, slot)
  const bucket = deltaBucket(delta, bounds)
  const label = describeDelta(
    sourceLabel,
    sourceRank,
    slot,
    slotLabel,
    beyondDepth,
  )

  return (
    <span
      className="delta-chip"
      data-arm={bucket.arm}
      data-level={bucket.level}
      data-missing={bucket.missing ? 'true' : undefined}
      title={label}
    >
      <span aria-hidden="true">{formatDelta(delta)}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
