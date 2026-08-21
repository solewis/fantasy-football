import type { PickRow } from '../../api/draft'
import {
  slotsFromRosterPositions,
  type RosterSlotTemplate,
} from '../../lib/rosterSlots'
import { PositionTag } from '../players/PositionTag'
import './draft.css'

interface DraftRosterPanelProps {
  picks: PickRow[]
  /** A league's real roster shape (Sleeper's roster_positions array). When
   * omitted (a manual or non-league-linked draft), falls back to a generic
   * standard-lineup template. */
  rosterPositions?: string[]
}

const DEFAULT_STARTER_SLOTS: readonly RosterSlotTemplate[] = [
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

const LETTER_BY_POSITION: Record<string, string> = {
  QB: 'Q',
  RB: 'R',
  WR: 'W',
  TE: 'T',
  K: 'K',
  DEF: 'D',
}

function isStandardFlex(eligible: readonly string[]): boolean {
  return (
    eligible.length === 3 &&
    ['RB', 'WR', 'TE'].every((p) => eligible.includes(p))
  )
}

interface AssignedSlot extends RosterSlotTemplate {
  pick: PickRow | null
}

function assignToSlots(
  picks: PickRow[],
  starterSlots: readonly RosterSlotTemplate[],
): {
  slots: AssignedSlot[]
  bench: PickRow[]
} {
  const slots: AssignedSlot[] = starterSlots.map((slot) => ({
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

function RosterSlotBadge({ slot }: { slot: RosterSlotTemplate }) {
  if (slot.eligible.length > 1) {
    const segments = isStandardFlex(slot.eligible)
      ? FLEX_SEGMENTS
      : slot.eligible.map((position) => ({
          letter: LETTER_BY_POSITION[position] ?? position.charAt(0),
          position,
        }))

    return (
      <span className="roster-slot-badge roster-slot-badge-flex">
        {segments.map((segment) => (
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
    <span className="roster-slot-badge" data-position={slot.eligible[0]}>
      {slot.label}
    </span>
  )
}

export function DraftRosterPanel({
  picks,
  rosterPositions,
}: DraftRosterPanelProps) {
  const starterSlots = rosterPositions
    ? slotsFromRosterPositions(rosterPositions)
    : DEFAULT_STARTER_SLOTS
  const { slots, bench } = assignToSlots(picks, starterSlots)

  return (
    <div className="draft-roster">
      <ul className="draft-roster-slots">
        {slots.map((slot, i) => (
          <li key={i} className="draft-roster-slot">
            <RosterSlotBadge slot={slot} />
            {slot.pick ? (
              <span className="draft-roster-slot-player">
                {slot.eligible.length > 1 && (
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
