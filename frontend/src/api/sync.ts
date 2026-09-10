export interface SyncInfo {
  last_synced_at: string | null
  record_count: number
}

export interface AdpSyncInfo extends SyncInfo {
  season: string
}

export interface EspnPlayersSyncInfo extends SyncInfo {
  adp_record_count: number
}

export interface SyncStatus {
  players: SyncInfo
  adp: AdpSyncInfo
  espn_players: SyncInfo
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

export async function fetchSyncStatus(season: string): Promise<SyncStatus> {
  const response = await fetch(
    `${API_BASE}/sync/status?season=${encodeURIComponent(season)}`,
  )
  return parseOrThrow(response, 'Fetching sync status')
}

export async function triggerPlayersSync(): Promise<SyncInfo> {
  const response = await fetch(`${API_BASE}/sync/players`, { method: 'POST' })
  return parseOrThrow(response, 'Syncing players')
}

export async function triggerAdpSync(season: string): Promise<AdpSyncInfo> {
  const response = await fetch(
    `${API_BASE}/sync/adp?season=${encodeURIComponent(season)}`,
    {
      method: 'POST',
    },
  )
  return parseOrThrow(response, 'Syncing ADP')
}

export async function triggerEspnPlayersSync(): Promise<EspnPlayersSyncInfo> {
  const response = await fetch(`${API_BASE}/sync/espn-players`, {
    method: 'POST',
  })
  return parseOrThrow(response, 'Syncing ESPN players')
}
