import { DeltaChip } from '../../components/DeltaChip'
import type { DeltaBounds } from '../../lib/deltaBuckets'
import '../../components/delta.css'

interface DeltaLegendProps {
  slot: number
  slotLabel: string
  bounds: DeltaBounds
}

/** What the chip colours mean, at the current slot.
 *
 * Built from the same bounds the chips use, so it can't drift out of date when
 * the scale changes.
 */
export function DeltaLegend({ slot, slotLabel, bounds }: DeltaLegendProps) {
  const samples = [
    -(bounds[3] + 1),
    -bounds[2],
    -bounds[0],
    0,
    bounds[0],
    bounds[2],
    bounds[3] + 1,
  ]

  return (
    <div
      className="delta-legend"
      role="img"
      aria-label={`Each chip is a source's rank minus ${slotLabel}. Negative means that source is higher on the player than this slot; the deeper the colour, the bigger the gap.`}
    >
      <span>higher than {slotLabel}</span>
      {samples.map((delta) => (
        <DeltaChip
          key={delta}
          sourceRank={slot + delta}
          slot={slot}
          bounds={bounds}
          sourceLabel="Example"
          slotLabel={slotLabel}
        />
      ))}
      <span>lower</span>
      <DeltaChip
        sourceRank={null}
        slot={slot}
        bounds={bounds}
        sourceLabel="Example"
        slotLabel={slotLabel}
      />
      <span>unranked</span>
    </div>
  )
}
