import { useState } from 'react'

import type { DatasetSummary } from '../../api/rankDatasets'
import { platformDisplayName } from '../../lib/platforms'
import { formatRelativeTime } from '../../lib/relativeTime'

interface SourceDatasetListProps {
  datasets: DatasetSummary[]
  /** Only the name-matching column is platform-specific; the datasets
   * themselves are platform-neutral. Named in the header so the platform
   * control above doesn't look like it scopes the whole page. */
  platform: string
  onReview: (datasetId: number) => void
  onDelete: (datasetId: number) => void
}

/** What a dataset can feed, said plainly -- a positional-only file genuinely
 * can't produce an overall list, and it's better to say so here than to have
 * the builder reject it later. */
function kindLabel(dataset: DatasetSummary): string {
  if (dataset.has_overall && dataset.has_positional)
    return 'Overall + positional'
  if (dataset.has_overall) return 'Overall only'
  if (dataset.has_positional) return 'Positional only'
  return 'No ranks'
}

export function SourceDatasetList({
  datasets,
  platform,
  onReview,
  onDelete,
}: SourceDatasetListProps) {
  const [confirmingId, setConfirmingId] = useState<number | null>(null)

  if (datasets.length === 0) {
    return (
      <p className="rankings-status">
        No ranking datasets yet — import a CSV to compare other people&apos;s
        ranks while you build.
      </p>
    )
  }

  return (
    <table className="sources-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Contains</th>
          <th>Rows</th>
          <th>Matched to {platformDisplayName(platform)}</th>
          <th>Imported</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {datasets.map((dataset) => {
          const needsReview = dataset.resolution?.needs_review ?? 0
          return (
            <tr key={dataset.id}>
              <td>
                <strong>{dataset.name}</strong>
                {dataset.has_tier && <span className="sources-tag">tiers</span>}
              </td>
              <td>{kindLabel(dataset)}</td>
              <td>{dataset.row_count}</td>
              <td>
                {needsReview > 0 ? (
                  <button
                    type="button"
                    className="sources-review-link"
                    onClick={() => onReview(dataset.id)}
                  >
                    {needsReview} need review →
                  </button>
                ) : (
                  <span className="sources-all-matched">All matched</span>
                )}
              </td>
              <td>{formatRelativeTime(dataset.imported_at)}</td>
              <td>
                {confirmingId === dataset.id ? (
                  <>
                    <button type="button" onClick={() => onDelete(dataset.id)}>
                      Confirm delete?
                    </button>
                    <button type="button" onClick={() => setConfirmingId(null)}>
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmingId(dataset.id)}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
