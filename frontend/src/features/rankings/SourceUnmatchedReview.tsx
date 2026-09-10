import { useCallback, useEffect, useState } from 'react'

import {
  confirmNames,
  fetchUnmatched,
  type UnmatchedName,
} from '../../api/rankDatasets'
import type { SupportedPlatform } from '../../components/PlatformTabs'

interface SourceUnmatchedReviewProps {
  datasetId: number
  platform: SupportedPlatform
  onDone: () => void
}

/** Resolve the names the matcher couldn't, one at a time.
 *
 * Keyboard-first because this is the tedious part: 1-5 picks a candidate,
 * Enter confirms and advances. Because names are keyed by their normalized
 * form, one decision resolves that name in every dataset -- which is what
 * makes the tedium pay off rather than repeat per file.
 */
export function SourceUnmatchedReview({
  datasetId,
  platform,
  onDone,
}: SourceUnmatchedReviewProps) {
  const [queue, setQueue] = useState<UnmatchedName[]>([])
  const [index, setIndex] = useState(0)
  const [selected, setSelected] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolvedCount, setResolvedCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    fetchUnmatched(datasetId, platform)
      .then((rows) => {
        if (!cancelled) setQueue(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load names')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [datasetId, platform])

  const current = queue[index]

  const resolve = useCallback(
    async (platformPlayerId: string | null) => {
      if (!current) return
      try {
        await confirmNames(datasetId, platform, [
          {
            normalized_name: current.normalized_name,
            source_name_raw: current.source_name_raw,
            platform_player_id: platformPlayerId,
          },
        ])
        setResolvedCount((n) => n + 1)
        setIndex((i) => i + 1)
        setSelected(0)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save')
      }
    },
    [current, datasetId, platform],
  )

  // Deliberately on the container, not window: a window listener registered in
  // an effect with [] captures the first render's queue, so "1" would forever
  // pick whoever was top at mount. React re-attaches this from the current
  // render every time.
  function handleKeyDown(event: React.KeyboardEvent) {
    if (!current) return
    const digit = Number(event.key)
    if (digit >= 1 && digit <= current.candidates.length) {
      setSelected(digit - 1)
      event.preventDefault()
      return
    }
    if (event.key === 'Enter' && current.candidates[selected]) {
      void resolve(current.candidates[selected].platform_player_id)
      event.preventDefault()
    }
    if (event.key.toLowerCase() === 'n') {
      void resolve(null)
      event.preventDefault()
    }
  }

  if (loading) return <p className="rankings-status">Loading…</p>

  if (!current) {
    return (
      <div className="sources-review">
        <p className="rankings-status">
          {resolvedCount > 0
            ? `Resolved ${resolvedCount} name${resolvedCount === 1 ? '' : 's'}.`
            : 'Nothing left to review.'}
        </p>
        <button type="button" onClick={onDone}>
          Back to sources
        </button>
      </div>
    )
  }

  return (
    /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */
    <div className="sources-review" tabIndex={-1} onKeyDown={handleKeyDown}>
      <div className="sources-review-head">
        <h3>
          Unmatched names — {index + 1} of {queue.length}
        </h3>
        <button type="button" onClick={onDone}>
          Done
        </button>
      </div>
      <p className="sources-review-note">
        Resolving a name fixes it in every dataset that has it.
      </p>

      {error && <p className="rankings-error">{error}</p>}

      <p className="sources-review-name">
        <strong>{current.source_name_raw}</strong>
        {current.position && <span> · {current.position}</span>}
      </p>

      <ul className="sources-candidates">
        {current.candidates.map((candidate, i) => (
          <li key={candidate.platform_player_id}>
            <button
              type="button"
              className={`sources-candidate${i === selected ? ' selected' : ''}`}
              onClick={() => void resolve(candidate.platform_player_id)}
            >
              <span className="sources-candidate-index">{i + 1}</span>
              <span>{candidate.name}</span>
              <span className="sources-candidate-meta">
                {candidate.position ?? '—'} · {candidate.team ?? '—'}
              </span>
              <span
                className="sources-score-bar"
                style={{ width: `${candidate.score}%` }}
                aria-hidden="true"
              />
              <span className="sources-candidate-score">
                {Math.round(candidate.score)}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="sources-review-actions">
        <button type="button" onClick={() => void resolve(null)}>
          Not a player (N)
        </button>
        <span className="sources-review-progress">
          {resolvedCount} resolved · {queue.length - index} left
        </span>
      </div>
    </div>
  )
}
