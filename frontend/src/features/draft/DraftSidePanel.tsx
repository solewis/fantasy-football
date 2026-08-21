import { useState } from 'react'

import type { PickRow, QueueRow } from '../../api/draft'
import { DraftQueuePanel } from './DraftQueuePanel'
import { DraftRosterPanel } from './DraftRosterPanel'
import './draft.css'

interface DraftSidePanelProps {
  queue: QueueRow[]
  myPicks: PickRow[]
  canDraft: boolean
  rosterPositions?: string[]
  onReorderQueue: (next: QueueRow[]) => void
  onRemoveFromQueue: (playerId: string) => void
  onDraftFromQueue: (playerId: string) => void
}

type Tab = 'queue' | 'roster'

export function DraftSidePanel({
  queue,
  myPicks,
  canDraft,
  rosterPositions,
  onReorderQueue,
  onRemoveFromQueue,
  onDraftFromQueue,
}: DraftSidePanelProps) {
  const [tab, setTab] = useState<Tab>('queue')

  return (
    <div className="draft-side-panel">
      <div
        className="draft-side-tabs"
        role="tablist"
        aria-label="Queue or roster"
      >
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'queue'}
          className={`draft-side-tab${tab === 'queue' ? ' active' : ''}`}
          onClick={() => setTab('queue')}
        >
          Queue
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'roster'}
          className={`draft-side-tab${tab === 'roster' ? ' active' : ''}`}
          onClick={() => setTab('roster')}
        >
          Roster
        </button>
      </div>
      <div className="draft-side-content">
        {tab === 'queue' ? (
          <DraftQueuePanel
            queue={queue}
            canDraft={canDraft}
            onReorder={onReorderQueue}
            onRemove={onRemoveFromQueue}
            onDraft={onDraftFromQueue}
          />
        ) : (
          <DraftRosterPanel picks={myPicks} rosterPositions={rosterPositions} />
        )}
      </div>
    </div>
  )
}
