/** Imported third-party ranking datasets, and the name-resolution queue they
 * produce. */

export interface ColumnMapping {
  name: number | null
  position: number | null
  team: number | null
  overall_rank: number | null
  position_rank: number | null
  tier: number | null
  /** The file is an ordered list with no rank column -- row order is the rank. */
  overall_rank_from_row_order: boolean
  /** The file is all one position and doesn't say so in a column. */
  single_position: string | null
}

export interface ParsedSampleRow {
  row_index: number
  source_name_raw: string
  normalized_name: string
  position: string | null
  team: string | null
  overall_rank: number | null
  position_rank: number | null
  position_rank_derived: boolean
  tier: number | null
}

export interface DatasetPreview {
  delimiter: string
  header_row_index: number
  columns: string[]
  mapping: ColumnMapping
  confidence: 'high' | 'low'
  row_count: number
  sample_rows: ParsedSampleRow[]
  detected: {
    has_overall: boolean
    has_positional: boolean
    has_tier: boolean
  }
  warnings: string[]
}

export interface DatasetSummary {
  id: number
  name: string
  season: string
  format: string
  has_overall: boolean
  has_positional: boolean
  has_tier: boolean
  row_count: number
  source_filename: string | null
  imported_at: string
  column_mapping?: ColumnMapping
  resolution?: { matched: number; needs_review: number }
}

export interface MatchCandidate {
  platform_player_id: string
  name: string
  position: string | null
  team: string | null
  score: number
}

export interface UnmatchedName {
  normalized_name: string
  source_name_raw: string
  position: string | null
  candidates: MatchCandidate[]
}

export interface NameConfirmation {
  normalized_name: string
  source_name_raw?: string
  /** null records a confirmed "not a player", so it's never asked again. */
  platform_player_id: string | null
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

/** Parse without saving, so the column mapping can be confirmed first. A wrong
 * guess produces a dataset that looks fine and quietly corrupts every
 * comparison built on it. */
export async function previewDataset(
  text: string,
  mapping?: ColumnMapping,
): Promise<DatasetPreview> {
  const response = await fetch(`${API_BASE}/rank-datasets/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, mapping }),
  })
  return parseOrThrow(response, 'Reading file')
}

export async function importDataset(params: {
  name: string
  text: string
  season: string
  format: string
  filename?: string
  mapping?: ColumnMapping
}): Promise<DatasetSummary> {
  const response = await fetch(`${API_BASE}/rank-datasets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  return parseOrThrow(response, 'Importing dataset')
}

export async function fetchDatasets(
  season: string,
  format: string,
): Promise<DatasetSummary[]> {
  const query = new URLSearchParams({ season, format })
  const response = await fetch(`${API_BASE}/rank-datasets?${query.toString()}`)
  return parseOrThrow(response, 'Fetching datasets')
}

export async function fetchDataset(
  datasetId: number,
  platform: string,
): Promise<DatasetSummary> {
  const query = new URLSearchParams({ platform })
  const response = await fetch(
    `${API_BASE}/rank-datasets/${datasetId}?${query.toString()}`,
  )
  return parseOrThrow(response, 'Fetching dataset')
}

export async function renameDataset(
  datasetId: number,
  name: string,
): Promise<DatasetSummary> {
  const response = await fetch(`${API_BASE}/rank-datasets/${datasetId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return parseOrThrow(response, 'Renaming dataset')
}

export async function deleteDataset(datasetId: number): Promise<void> {
  const response = await fetch(`${API_BASE}/rank-datasets/${datasetId}`, {
    method: 'DELETE',
  })
  if (!response.ok) {
    throw new Error(`Deleting dataset failed: ${response.status}`)
  }
}

export async function fetchUnmatched(
  datasetId: number,
  platform: string,
): Promise<UnmatchedName[]> {
  const query = new URLSearchParams({ platform })
  const response = await fetch(
    `${API_BASE}/rank-datasets/${datasetId}/unmatched?${query.toString()}`,
  )
  return parseOrThrow(response, 'Fetching unmatched names')
}

/** Confirms a batch as one transaction. Because names are keyed by their
 * normalized form, one decision resolves that name in every dataset. */
export async function confirmNames(
  datasetId: number,
  platform: string,
  confirmations: NameConfirmation[],
): Promise<{ confirmed: number; remaining_unmatched: number }> {
  const query = new URLSearchParams({ platform })
  const response = await fetch(
    `${API_BASE}/rank-datasets/${datasetId}/mappings?${query.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmations }),
    },
  )
  return parseOrThrow(response, 'Confirming names')
}
