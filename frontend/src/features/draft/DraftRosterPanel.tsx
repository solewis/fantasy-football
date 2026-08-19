import type { PickRow } from '../../api/draft'
import { PositionTag } from '../players/PositionTag'
import './draft.css'

interface DraftRosterPanelProps {
  picks: PickRow[]
}

const POSITION_ORDER = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const

export function DraftRosterPanel({ picks }: DraftRosterPanelProps) {
  if (picks.length === 0) {
    return <p className="draft-roster-empty">No players drafted yet.</p>
  }

  const byPosition = new Map<string, PickRow[]>()
  for (const pick of picks) {
    const key = pick.position ?? 'Other'
    const group = byPosition.get(key)
    if (group) {
      group.push(pick)
    } else {
      byPosition.set(key, [pick])
    }
  }

  const knownGroups = POSITION_ORDER.filter((position) =>
    byPosition.has(position),
  )
  const otherGroups = Array.from(byPosition.keys()).filter(
    (position) => !(POSITION_ORDER as readonly string[]).includes(position),
  )
  const orderedGroups = [...knownGroups, ...otherGroups]

  return (
    <div className="draft-roster">
      {orderedGroups.map((position) => (
        <div key={position} className="draft-roster-group">
          <h4>{position}</h4>
          <ul>
            {(byPosition.get(position) ?? []).map((pick) => (
              <li key={pick.platform_player_id}>
                <PositionTag position={pick.position} />
                <span>{pick.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
