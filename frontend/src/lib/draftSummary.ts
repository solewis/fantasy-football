import type { DraftListRow, DraftStatus } from '../api/draft'

/** Just enough of a draft to render "is there one, and how far along" --
 * narrower than DraftListRow/DraftStatus on purpose, since this is the only
 * shape the Leagues UI actually displays before handing off to DraftRoom
 * (which reads the real DraftStatus itself once resumed). */
export interface DraftSummary {
  id: number
  next_pick_number: number | null
  current_round: number | null
  is_complete: boolean
}

export function draftSummaryFromStatus(status: DraftStatus): DraftSummary {
  return {
    id: status.draft.id,
    next_pick_number: status.next_pick_number,
    current_round: status.current_round,
    is_complete: status.is_complete,
  }
}

/** Same narrowing, from the GET /drafts list shape -- used by the Leagues
 * container to build the per-league draft map the detail page's `draft`
 * prop is drawn from. */
export function draftSummaryFromListRow(row: DraftListRow): DraftSummary {
  return {
    id: row.id,
    next_pick_number: row.next_pick_number,
    current_round: row.current_round,
    is_complete: row.is_complete,
  }
}
