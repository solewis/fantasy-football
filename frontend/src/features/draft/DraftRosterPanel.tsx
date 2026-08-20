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

export function DraftRosterPanel({ picks }: DraftRosterPanelProps) {
  const { slots, bench } = assignToSlots(picks)

  return (
    <div className="draft-roster">
      <ul className="draft-roster-slots">
        {slots.map((slot, i) => (
          <li key={i} className="draft-roster-slot">
            <span className="draft-roster-slot-label">{slot.label}</span>
            {slot.pick ? (
              <span className="draft-roster-slot-player">
                <PositionTag position={slot.pick.position} />
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
