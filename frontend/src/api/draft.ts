export interface DraftSettings {
  id: number
  season: string
  format: string
  num_teams: number
  num_rounds: number
  my_slot: number
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

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000'

async function parseOrThrow<T>(response: Response, label: string): Promise<T> {
  if (!response.ok) {
    let detail = ''
    try {
      const body = (await response.json()) as { detail?: string }
      detail = body.detail ?? ''
    } catch {
      // response body wasn't JSON -- fall back to just the status code
    }
    throw new Error(
      detail ? `${label}: ${detail}` : `${label} failed: ${response.status}`,
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

export async function fetchDraftStatus(draftId: number): Promise<DraftStatus> {
  const response = await fetch(`${API_BASE}/drafts/${draftId}`)
  return parseOrThrow(response, 'Fetching draft')
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
