import { useEffect, useRef, useState } from 'react'

import { fetchPlayers } from '../../api/players'
import { fetchRanks, saveRanks, type RankRow } from '../../api/ranks'
import { PositionTag } from '../players/PositionTag'
import { reorderList } from './reorder'
import './rankings.css'

const FORMATS = [
  { value: 'std', label: 'Standard' },
  { value: 'ppr', label: 'PPR' },
  { value: 'half_ppr', label: 'Half PPR' },
  { value: '2qb', label: '2QB / Superflex' },
  { value: 'dynasty_std', label: 'Dynasty (Std)' },
  { value: 'dynasty_ppr', label: 'Dynasty (PPR)' },
  { value: 'dynasty_half_ppr', label: 'Dynasty (Half PPR)' },
] as const

const SEASON = '2026'

type Source = 'saved' | 'adp' | null

export function RankingsPage() {
  const [format, setFormat] = useState('half_ppr')
  const [workingList, setWorkingList] = useState<RankRow[]>([])
  const [source, setSource] = useState<Source>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  // State drives the "dragging" CSS highlight (fine to be a render behind);
  // the ref is what handleDrop actually reads, since a dragstart -> drop pair
  // can fire before React flushes the state update from dragstart, and a
  // stale closure there would silently drop the reorder.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const draggedIdRef = useRef<string | null>(null)

  function selectFormat(next: string) {
    setLoading(true)
    setSaveMessage(null)
    setFormat(next)
  }

  useEffect(() => {
    let cancelled = false

    fetchRanks({ season: SEASON, format })
      .then(async (savedRows) => {
        if (cancelled) return
        if (savedRows.length > 0) {
          setWorkingList(savedRows)
          setSource('saved')
          return
        }
        const adpRows = await fetchPlayers({ season: SEASON, format })
        if (cancelled) return
        setWorkingList(adpRows)
        setSource('adp')
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load rankings',
          )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [format])

  async function handleLoadFromAdp() {
    setLoading(true)
    setError(null)
    setSaveMessage(null)
    try {
      const rows = await fetchPlayers({ season: SEASON, format })
      setWorkingList(rows)
      setSource('adp')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ADP order')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const result = await saveRanks(
        { season: SEASON, format },
        workingList.map((row) => row.platform_player_id),
      )
      setSaveMessage(`Saved ${result.count} ranks`)
      setSource('saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save ranks')
    } finally {
      setSaving(false)
    }
  }

  function startDrag(id: string) {
    draggedIdRef.current = id
    setDraggedId(id)
  }

  function endDrag() {
    draggedIdRef.current = null
    setDraggedId(null)
  }

  function handleDrop(targetId: string | null) {
    const dragged = draggedIdRef.current
    if (dragged) {
      setWorkingList((prev) => reorderList(prev, dragged, targetId))
      setSaveMessage(null)
    }
    endDrag()
  }

  return (
    <div className="rankings-page">
      <div className="rankings-toolbar">
        <select
          className="rankings-format"
          value={format}
          onChange={(e) => selectFormat(e.target.value)}
          aria-label="Scoring format"
        >
          {FORMATS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <button type="button" onClick={handleLoadFromAdp} disabled={loading}>
          Load from ADP
        </button>
        <button
          type="button"
          className="rankings-save"
          onClick={handleSave}
          disabled={saving || workingList.length === 0}
        >
          {saving ? 'Saving…' : 'Save Ranks'}
        </button>
        {saveMessage && (
          <span className="rankings-save-message">{saveMessage}</span>
        )}
      </div>

      {source === 'adp' && (
        <p className="rankings-source-note">
          Starting from ADP order — drag to reorder, then Save Ranks to keep
          your changes.
        </p>
      )}

      <div className="rankings-table-wrapper">
        {loading && workingList.length === 0 ? (
          <p className="rankings-status">Loading…</p>
        ) : error ? (
          <p className="rankings-error">{error}</p>
        ) : workingList.length === 0 ? (
          <p className="rankings-status">
            No players available for this format.
          </p>
        ) : (
          <table className="rankings-table">
            <thead>
              <tr>
                <th>Rk</th>
                <th>ADP</th>
                <th>Name</th>
                <th>Team</th>
              </tr>
            </thead>
            <tbody>
              {workingList.map((row, index) => (
                <tr
                  key={row.platform_player_id}
                  draggable
                  className={
                    draggedId === row.platform_player_id ? 'dragging' : ''
                  }
                  onDragStart={() => startDrag(row.platform_player_id)}
                  onDragEnd={endDrag}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault()
                    handleDrop(row.platform_player_id)
                  }}
                >
                  <td>{index + 1}</td>
                  <td>{row.adp !== null ? row.adp.toFixed(1) : '—'}</td>
                  <td>
                    <PositionTag position={row.position} />
                    <span className="player-name">{row.name}</span>
                  </td>
                  <td>{row.team ?? '—'}</td>
                </tr>
              ))}
              <tr
                className="rankings-end-zone"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault()
                  handleDrop(null)
                }}
              >
                <td colSpan={4}>Drop here to move to the end</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
