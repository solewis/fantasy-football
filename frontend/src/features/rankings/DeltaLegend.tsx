import {
  armOf,
  deltaBucket,
  formatDelta,
  thresholdsAt,
} from '../../lib/deltaBuckets'
import './delta.css'

interface DeltaLegendProps {
  slot: number
  slotLabel: string
}

/** What the chip colours mean, at the current slot.
 *
 * Rendered from the same thresholds the chips use, so it stays honest as the
 * bands widen deeper into a list rather than drifting out of date.
 */
export function DeltaLegend({ slot, slotLabel }: DeltaLegendProps) {
  const thresholds = thresholdsAt(slot)
  const samples = [
    -(thresholds.moderate + 2),
    -thresholds.moderate,
    -1,
    0,
    1,
    thresholds.moderate,
    thresholds.moderate + 2,
  ]

  return (
    <div
      className="delta-legend"
      role="img"
      aria-label={`Each chip is a source's rank minus ${slotLabel}. Negative means that source is higher on the player than this slot.`}
    >
      <span>higher than {slotLabel}</span>
      {samples.map((delta) => {
        const bucket = deltaBucket(delta, thresholds)
        return (
          <span
            key={delta}
            className="delta-chip"
            data-bucket={bucket}
            data-arm={armOf(bucket)}
            aria-hidden="true"
          >
            {formatDelta(delta)}
          </span>
        )
      })}
      <span>lower</span>
      <span className="delta-chip" data-bucket="missing" aria-hidden="true">
        —
      </span>
      <span>unranked</span>
    </div>
  )
}
