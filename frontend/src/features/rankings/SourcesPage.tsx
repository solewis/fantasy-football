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
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const loading = loadedKey !== `${platform}:${format}`
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [reviewingId, setReviewingId] = useState<number | null>(null)

  const reload = useCallback(async () => {
    const rows = await fetchDatasets(SEASON, format, platform)
    setDatasets(rows)
  }, [format, platform])

  useEffect(() => {
    let cancelled = false
    fetchDatasets(SEASON, format, platform)
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
        if (!cancelled) setLoadedKey(`${platform}:${format}`)
      })
    return () => {
      cancelled = true
    }
  }, [format, platform])

  async function handleDelete(datasetId: number) {
    try {
      await deleteDataset(datasetId)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete dataset')
    }
  }

  if (reviewingId !== null) {
    // Kept inside the page wrapper -- returning the review screen bare made it
    // escape the layout's padding and centering.
    return (
      <div className="sources-page">
        <SourceUnmatchedReview
          datasetId={reviewingId}
          platform={platform}
          onDone={() => {
            setReviewingId(null)
            void reload()
          }}
        />
      </div>
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
        <>
          <p className="sources-note">
            {`A ranking file is just names, so each one has to be matched to a
            player on a specific platform — Sleeper and ESPN keep separate player
            lists with no link between them. The files themselves aren't
            platform-specific: one import serves both, you just confirm any
            unrecognised names once per platform.`}
          </p>
          <SourceDatasetList
            datasets={datasets}
            platform={platform}
            onReview={setReviewingId}
            onDelete={handleDelete}
          />
        </>
      )}
    </div>
  )
}
