export interface DraftSettings {
  id: number
  platform: string
  platform_draft_id: string | null
  league_id: number | null
  season: string
  format: string
  num_teams: number
  num_rounds: number
  my_slot: number
  rank_set_id: number | null
  roster_positions: string[] | null
  team_names: Record<string, string>
}

export interface PickRow {
  pick_number: number
  round: number
  slot: number
  platform_player_id: string
  name: string
  position: string | null
  team: string | null
}

export interface DraftStatus {
  draft: DraftSettings
  picks: PickRow[]
  next_pick_number: number | null
  current_round: number | null
  current_slot: number | null
  is_my_turn: boolean
  is_complete: boolean
}

export interface QueueRow {
  platform_player_id: string
  name: string
  position: string | null
  team: string | null
}

export interface CreateDraftParams {
  season: string
  format: string
  num_teams: number
  num_rounds: number
  my_slot: number
}

export interface CreateSleeperDraftParams {
  platform_draft_id: string
  format: string
  my_slot: number
}

export interface CreateDraftFromLeagueParams {
  league_id: number
  my_slot: number
}

/** A lightweight per-draft summary from `GET /drafts` -- not a full
 * DraftStatus (no picks, no rank_set_id/roster_positions). Used by the
 * Leagues list/detail views to show "is there a draft, and how far along."
 */
export interface DraftListRow {
  id: number
  platform: string
  league_id: number | null
  season: string
  format: string
  num_teams: number
  num_rounds: number
  my_slot: number
  pick_count: number
  next_pick_number: number | null
  current_round: number | null
  is_complete: boolean
  created_at: string
}

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000'

/** Thrown by parseOrThrow with the real HTTP status attached, so a caller can
 * distinguish "not found" (safe to fall back to a fresh setup flow) from a
 * transient failure (should surface as an error, not silently invite creating
 * a duplicate draft).
 */
export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function parseOrThrow<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: string }
      detail = body.detail ?? ''
    } catch {
      // response body wasn't JSON -- fall back to just the status code
    }
    throw new ApiError(
      detail ? `${label}: ${detail}` : `${label} failed: ${response.status}`,
      response.status,
    )
  }
  return response.json() as Promise<T>
}

export async function createDraft(
  params: CreateDraftParams,
): Promise<DraftStatus> {
  const response = await fetch(`${API_BASE}/drafts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return parseOrThrow(response, 'Creating draft')
}

export async function createSleeperDraft(
  params: CreateSleeperDraftParams,
): Promise<DraftStatus> {
  const response = await fetch(`${API_BASE}/drafts/sleeper`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return parseOrThrow(response, 'Creating Sleeper draft')
}

export async function createDraftFromLeague(
  params: CreateDraftFromLeagueParams,
): Promise<DraftStatus> {
  const response = await fetch(`${API_BASE}/drafts/league`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return parseOrThrow(response, 'Creating draft from league')
}

export async function fetchDrafts(leagueId?: number): Promise<DraftListRow[]> {
  const query = leagueId != null ? `?league_id=${leagueId}` : ''
  const response = await fetch(`${API_BASE}/drafts${query}`)
  return parseOrThrow(response, 'Fetching drafts')
}

export async function fetchDraftStatus(draftId: number): Promise<DraftStatus> {
  const response = await fetch(`${API_BASE}/drafts/${draftId}`)
  return parseOrThrow(response, 'Fetching draft')
}

export async function syncSleeperDraft(draftId: number): Promise<DraftStatus> {
  const response = await fetch(`${API_BASE}/drafts/${draftId}/sync`, {
    method: 'POST',
  })
  return parseOrThrow(response, 'Syncing draft')
}

export async function switchToManual(draftId: number): Promise<DraftStatus> {
  const response = await fetch(
    `${API_BASE}/drafts/${draftId}/switch-to-manual`,
    {
      method: 'POST',
    },
  )
  return parseOrThrow(response, 'Switching to manual')
}

export async function makePick(
  draftId: number,
  platformPlayerId: string,
): Promise<{ pick_number: number }> {
  const response = await fetch(`${API_BASE}/drafts/${draftId}/picks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform_player_id: platformPlayerId }),
  })
  return parseOrThrow(response, 'Making pick')
}

export async function undoLastPick(
  draftId: number,
): Promise<{ pick_number: number } | null> {
  const response = await fetch(`${API_BASE}/drafts/${draftId}/picks`, {
    method: 'DELETE',
  })
  return parseOrThrow(response, 'Undoing pick')
}

export async function fetchQueue(draftId: number): Promise<QueueRow[]> {
  const response = await fetch(`${API_BASE}/drafts/${draftId}/queue`)
  return parseOrThrow(response, 'Fetching queue')
}

export async function saveQueue(
  draftId: number,
  platformPlayerIds: string[],
): Promise<{ count: number }> {
  const response = await fetch(`${API_BASE}/drafts/${draftId}/queue`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform_player_ids: platformPlayerIds }),
  })
  return parseOrThrow(response, 'Saving queue')
}
