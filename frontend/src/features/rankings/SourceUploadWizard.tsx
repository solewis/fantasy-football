import { useState } from 'react'

import {
  importDataset,
  previewDataset,
  type ColumnMapping,
  type DatasetPreview,
} from '../../api/rankDatasets'
import { SEASON } from '../../lib/formats'
import { SourceColumnMapper } from './SourceColumnMapper'

interface SourceUploadWizardProps {
  format: string
  onCancel: () => void
  onImported: () => void
}

/** File picker → parse preview → confirm the column mapping → import.
 *
 * The confirm step isn't ceremony: a wrong column guess produces a dataset
 * that looks perfectly fine and quietly corrupts every comparison built on it,
 * which you'd discover on draft day. Reading the file and eyeballing ten rows
 * costs seconds.
 *
 * Parsing happens server-side. Doing it in the browser would mean two parsers
 * that have to agree forever; the browser only reads the bytes.
 */
export function SourceUploadWizard({
  format,
  onCancel,
  onImported,
}: SourceUploadWizardProps) {
  const [name, setName] = useState('')
  const [text, setText] = useState<string | null>(null)
  const [preview, setPreview] = useState<DatasetPreview | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleFile(file: File | undefined) {
    if (!file) return
    setBusy(true)
    setError(null)
    try {
      const contents = await file.text()
      const result = await previewDataset(contents)
      setText(contents)
      setPreview(result)
      setMapping(result.mapping)
      if (name.trim() === '') setName(file.name.replace(/\.[^.]+$/, ''))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read file')
    } finally {
      setBusy(false)
    }
  }

  async function refreshPreview(next: ColumnMapping) {
    setMapping(next)
    if (text === null) return
    try {
      setPreview(await previewDataset(text, next))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to re-read file')
    }
  }

  async function handleImport() {
    if (text === null || mapping === null) return
    setBusy(true)
    setError(null)
    try {
      await importDataset({
        name: name.trim(),
        text,
        season: SEASON,
        format,
        mapping,
      })
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to import')
    } finally {
      setBusy(false)
    }
  }

  const hasRanks =
    mapping !== null &&
    (mapping.overall_rank !== null ||
      mapping.position_rank !== null ||
      mapping.overall_rank_from_row_order)
  const needsSinglePosition =
    mapping !== null &&
    mapping.position_rank !== null &&
    mapping.position === null &&
    !mapping.single_position
  const canImport =
    !busy &&
    name.trim() !== '' &&
    mapping !== null &&
    mapping.name !== null &&
    hasRanks &&
    !needsSinglePosition

  return (
    <div className="sources-wizard">
      <div className="sources-wizard-head">
        <label>
          Rankings file
          <input
            type="file"
            accept=".csv,.tsv,.txt"
            onChange={(e) => void handleFile(e.target.files?.[0])}
          />
        </label>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {error && <p className="rankings-error">{error}</p>}

      {preview && mapping && (
        <>
          <label className="sources-name-field">
            Name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-label="Dataset name"
              placeholder="e.g. FantasyPros Half PPR"
            />
          </label>

          {preview.confidence === 'low' && (
            <p className="sources-warning">
              We couldn&apos;t confidently read this file&apos;s columns — check
              the mapping below carefully.
            </p>
          )}
          {preview.warnings.map((warning) => (
            <p key={warning} className="sources-warning">
              {warning}
            </p>
          ))}

          <SourceColumnMapper
            columns={preview.columns}
            mapping={mapping}
            sampleRows={preview.sample_rows}
            rowCount={preview.row_count}
            onChange={(next) => void refreshPreview(next)}
          />

          {!hasRanks && (
            <p className="sources-warning">
              Map a rank column, or tick &ldquo;row order is the rank&rdquo;.
            </p>
          )}
          {needsSinglePosition && (
            <p className="sources-warning">
              This file has positional ranks but no position column — pick the
              position it covers.
            </p>
          )}

          <button type="button" onClick={handleImport} disabled={!canImport}>
            {busy ? 'Importing…' : `Import ${preview.row_count} rows`}
          </button>
        </>
      )}
    </div>
  )
}
