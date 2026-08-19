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

const API_BASE = import.meta.env.VITE_API_BASE ?? 'http://127.0.0.1:8000'

export async function fetchRanks(scope: RanksScope): Promise<RankRow[]> {
  const query = new URLSearchParams({
    season: scope.season,
    format: scope.format,
  })
  const response = await fetch(`${API_BASE}/ranks?${query.toString()}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch ranks: ${response.status}`)
  }
  return response.json() as Promise<RankRow[]>
}

export async function saveRanks(
  scope: RanksScope,
  platformPlayerIds: string[],
): Promise<{ count: number }> {
  const query = new URLSearchParams({
    season: scope.season,
    format: scope.format,
  })
  const response = await fetch(`${API_BASE}/ranks?${query.toString()}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform_player_ids: platformPlayerIds }),
  })
  if (!response.ok) {
    throw new Error(`Failed to save ranks: ${response.status}`)
  }
  return response.json() as Promise<{ count: number }>
}
