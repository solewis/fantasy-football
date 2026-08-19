import { useEffect, useState } from 'react'

import {
  fetchSyncStatus,
  triggerAdpSync,
  triggerPlayersSync,
  type SyncStatus,
} from '../../api/sync'
import { formatExactDateTime, formatRelativeTime } from '../../lib/relativeTime'
import './sync-panel.css'

interface SyncPanelProps {
  season: string
  onSyncComplete: () => void
}

export function SyncPanel({ season, onSyncComplete }: SyncPanelProps) {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [syncingPlayers, setSyncingPlayers] = useState(false)
  const [syncingAdp, setSyncingAdp] = useState(false)

  useEffect(() => {
    let cancelled = false

    fetchSyncStatus(season)
      .then((result) => {
        if (!cancelled) setStatus(result)
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load sync status',
          )
      })

    return () => {
      cancelled = true
    }
  }, [season])

  async function handleSyncPlayers() {
    setSyncingPlayers(true)
    setError(null)
    try {
      const result = await triggerPlayersSync()
      setStatus((prev) => (prev ? { ...prev, players: result } : prev))
      onSyncComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync players')
    } finally {
      setSyncingPlayers(false)
    }
  }

  async function handleSyncAdp() {
    setSyncingAdp(true)
    setError(null)
    try {
      const result = await triggerAdpSync(season)
      setStatus((prev) => (prev ? { ...prev, adp: result } : prev))
      onSyncComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to sync ADP')
    } finally {
      setSyncingAdp(false)
    }
  }

  return (
    <div className="sync-panel">
      <div className="sync-row">
        <span className="sync-label">Players</span>
        <span
          className="sync-meta"
          title={
            status
              ? formatExactDateTime(status.players.last_synced_at)
              : undefined
          }
        >
          {status
            ? `${formatRelativeTime(status.players.last_synced_at)} · ${status.players.record_count} players`
            : '—'}
        </span>
        <button
          type="button"
          onClick={handleSyncPlayers}
          disabled={syncingPlayers}
        >
          {syncingPlayers ? 'Syncing…' : 'Sync players'}
        </button>
      </div>
      <div className="sync-row">
        <span className="sync-label">ADP ({season})</span>
        <span
          className="sync-meta"
          title={
            status ? formatExactDateTime(status.adp.last_synced_at) : undefined
          }
        >
          {status
            ? `${formatRelativeTime(status.adp.last_synced_at)} · ${status.adp.record_count} rows`
            : '—'}
        </span>
        <button type="button" onClick={handleSyncAdp} disabled={syncingAdp}>
          {syncingAdp ? 'Syncing…' : 'Sync ADP'}
        </button>
      </div>
      {error && <p className="sync-error">{error}</p>}
    </div>
  )
}
