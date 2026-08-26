import {
  armOf,
  deltaBucket,
  describeDelta,
  formatDelta,
  rankDelta,
  thresholdsAt,
} from '../../lib/deltaBuckets'
import './delta.css'

interface DeltaChipProps {
  /** null when this source doesn't rank the player. */
  sourceRank: number | null
  slot: number
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
  sourceLabel,
  slotLabel,
  beyondDepth = false,
}: DeltaChipProps) {
  const delta = rankDelta(sourceRank, slot)
  const bucket = deltaBucket(delta, thresholdsAt(slot))
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
      data-bucket={bucket}
      data-arm={armOf(bucket)}
      title={label}
    >
      <span aria-hidden="true">{formatDelta(delta)}</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
