import type { PickRow } from '../../api/draft'
import { PositionTag } from '../players/PositionTag'
import './draft.css'

interface DraftRosterPanelProps {
  picks: PickRow[]
}

interface RosterSlotTemplate {
  label: string
  eligible: readonly string[]
}

const STARTER_SLOTS: readonly RosterSlotTemplate[] = [
  { label: 'QB', eligible: ['QB'] },
  { label: 'RB', eligible: ['RB'] },
  { label: 'RB', eligible: ['RB'] },
  { label: 'WR', eligible: ['WR'] },
  { label: 'WR', eligible: ['WR'] },
  { label: 'TE', eligible: ['TE'] },
  { label: 'FLEX', eligible: ['RB', 'WR', 'TE'] },
  { label: 'K', eligible: ['K'] },
  { label: 'DEF', eligible: ['DEF'] },
]

const FLEX_SEGMENTS = [
  { letter: 'W', position: 'WR' },
  { letter: 'R', position: 'RB' },
  { letter: 'T', position: 'TE' },
]

interface AssignedSlot extends RosterSlotTemplate {
  pick: PickRow | null
}

function assignToSlots(picks: PickRow[]): {
  slots: AssignedSlot[]
  bench: PickRow[]
} {
  const slots: AssignedSlot[] = STARTER_SLOTS.map((slot) => ({
    ...slot,
    pick: null,
  }))
  const bench: PickRow[] = []

  for (const pick of picks) {
    const position = pick.position ?? ''
    const exactSlot = slots.find(
      (slot) =>
        slot.pick === null &&
        slot.eligible.length === 1 &&
        slot.eligible[0] === position,
    )
    if (exactSlot) {
      exactSlot.pick = pick
      continue
    }

    const flexSlot = slots.find(
      (slot) =>
        slot.pick === null &&
        slot.eligible.length > 1 &&
        slot.eligible.includes(position),
    )
    if (flexSlot) {
      flexSlot.pick = pick
      continue
    }

    bench.push(pick)
  }

  return { slots, bench }
}

function RosterSlotBadge({ label }: { label: string }) {
  if (label === 'FLEX') {
    return (
      <span className="roster-slot-badge roster-slot-badge-flex">
        {FLEX_SEGMENTS.map((segment) => (
          <span
            key={segment.position}
            className="roster-slot-badge-segment"
            data-position={segment.position}
          >
            {segment.letter}
          </span>
        ))}
      </span>
    )
  }

  return (
    <span className="roster-slot-badge" data-position={label}>
      {label}
    </span>
  )
}

export function DraftRosterPanel({ picks }: DraftRosterPanelProps) {
  const { slots, bench } = assignToSlots(picks)

  return (
    <div className="draft-roster">
      <ul className="draft-roster-slots">
        {slots.map((slot, i) => (
          <li key={i} className="draft-roster-slot">
            <RosterSlotBadge label={slot.label} />
            {slot.pick ? (
              <span className="draft-roster-slot-player">
                {slot.label === 'FLEX' && (
                  <PositionTag position={slot.pick.position} />
                )}
                <span>{slot.pick.name}</span>
              </span>
            ) : (
              <span className="draft-roster-slot-empty">Empty</span>
            )}
          </li>
        ))}
      </ul>

      <div className="draft-roster-group">
        <h4>Bench</h4>
        {bench.length === 0 ? (
          <p className="draft-roster-empty">No bench players yet.</p>
        ) : (
          <ul>
            {bench.map((pick) => (
              <li key={pick.platform_player_id}>
                <PositionTag position={pick.position} />
                <span>{pick.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
