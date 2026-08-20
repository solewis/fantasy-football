export interface RankRow {
  rank: number
  platform_player_id: string
  name: string
  position: string | null
  team: string | null
  adp: number | null
}

export interface RanksScope {
  season: string
  format: string
}

export interface RankSetSummary {
  id: number
  name: string
  platform: string
  season: string
  format: string
  player_count: number
}

export interface CreateRankSetParams {
  name: string
  season: string
  format: string
  seed_from_adp?: boolean
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

/** ADP-fallback read used by the draft player pool -- see the backend's
 * resolve_rank_set() for the "which rank set does this mean" caveat. */
export async function fetchRanks(scope: RanksScope): Promise<RankRow[]> {
  const query = new URLSearchParams({
    season: scope.season,
    format: scope.format,
  })
  const response = await fetch(`${API_BASE}/ranks?${query.toString()}`)
  return parseOrThrow(response, 'Fetching ranks')
}

export async function fetchRankSets(
  scope: RanksScope,
): Promise<RankSetSummary[]> {
  const query = new URLSearchParams({
    season: scope.season,
    format: scope.format,
  })
  const response = await fetch(`${API_BASE}/rank-sets?${query.toString()}`)
  return parseOrThrow(response, 'Fetching rank sets')
}

export async function createRankSet(
  params: CreateRankSetParams,
): Promise<RankSetSummary> {
  const response = await fetch(`${API_BASE}/rank-sets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return parseOrThrow(response, 'Creating rank set')
}

export async function renameRankSet(
  rankSetId: number,
  name: string,
): Promise<RankSetSummary> {
  const response = await fetch(`${API_BASE}/rank-sets/${rankSetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return parseOrThrow(response, 'Renaming rank set')
}

export async function deleteRankSet(rankSetId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/rank-sets/${rankSetId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error(`Deleting rank set failed: ${response.status}`)
  }
}

export async function fetchRanksForSet(rankSetId: number): Promise<RankRow[]> {
  const response = await fetch(`${API_BASE}/rank-sets/${rankSetId}/ranks`)
  return parseOrThrow(response, 'Fetching ranks')
}

export async function saveRanksForSet(
  rankSetId: number,
  platformPlayerIds: string[],
): Promise<{ count: number }> {
  const response = await fetch(`${API_BASE}/rank-sets/${rankSetId}/ranks`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform_player_ids: platformPlayerIds }),
  })
  return parseOrThrow(response, 'Saving ranks')
}
