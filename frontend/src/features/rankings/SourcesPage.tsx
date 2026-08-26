import { useCallback, useEffect, useState } from 'react'

import {
  deleteDataset,
  fetchDatasets,
  type DatasetSummary,
} from '../../api/rankDatasets'
import type { SupportedPlatform } from '../../components/PlatformTabs'
import { SEASON } from '../../lib/formats'
import { SourceDatasetList } from './SourceDatasetList'
import { SourceUnmatchedReview } from './SourceUnmatchedReview'
import { SourceUploadWizard } from './SourceUploadWizard'
import './sources.css'

interface SourcesPageProps {
  platform: SupportedPlatform
  format: string
}

/** Manage imported ranking datasets: upload, review unmatched names, delete. */
export function SourcesPage({ platform, format }: SourcesPageProps) {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([])
  // Derived, not state set from inside the effect -- the key is only written
  // from an async continuation, so there's nothing to reset up front and no
  // cascading render.
  const [loadedFormat, setLoadedFormat] = useState<string | null>(null)
  const loading = loadedFormat !== format
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [reviewingId, setReviewingId] = useState<number | null>(null)

  const reload = useCallback(async () => {
    const rows = await fetchDatasets(SEASON, format)
    setDatasets(rows)
  }, [format])

  useEffect(() => {
    let cancelled = false
    fetchDatasets(SEASON, format)
      .then((rows) => {
        if (!cancelled) setDatasets(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load datasets',
          )
      })
      .finally(() => {
        if (!cancelled) setLoadedFormat(format)
      })
    return () => {
      cancelled = true
    }
  }, [format])

  async function handleDelete(datasetId: number) {
    try {
      await deleteDataset(datasetId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete dataset')
    }
  }

  if (reviewingId !== null) {
    return (
      <SourceUnmatchedReview
        datasetId={reviewingId}
        platform={platform}
        onDone={() => {
          setReviewingId(null)
          void reload()
        }}
      />
    )
  }

  return (
    <div className="sources-page">
      {error && <p className="rankings-error">{error}</p>}

      {uploading ? (
        <SourceUploadWizard
          format={format}
          onCancel={() => setUploading(false)}
          onImported={() => {
            setUploading(false)
            void reload()
          }}
        />
      ) : (
        <div className="sources-toolbar">
          <button type="button" onClick={() => setUploading(true)}>
            + Import Rankings
          </button>
        </div>
      )}

      {loading ? (
        <p className="rankings-status">Loading…</p>
      ) : (
        <SourceDatasetList
          datasets={datasets}
          onReview={setReviewingId}
          onDelete={handleDelete}
        />
      )}
    </div>
  )
}
