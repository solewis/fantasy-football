import { useEffect, useRef, useState } from 'react'

import { fetchPlayers } from '../../api/players'
import { fetchRanks, saveRanks, type RankRow } from '../../api/ranks'
import { PositionTag } from '../players/PositionTag'
import { isBelowMidpoint, reorderList } from './reorder'
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
  // the ref is what dragover/drop actually read, since those DOM events can
  // fire before React flushes a state update, and a stale closure there
  // would silently drop the reorder.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const draggedIdRef = useRef<string | null>(null)
  // Skips redundant reorders (and re-renders) while the cursor sits still
  // within the same half of the same row -- dragover fires continuously.
  const lastHoverKeyRef = useRef<string | null>(null)

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
    lastHoverKeyRef.current = null
    setDraggedId(id)
  }

  function endDrag() {
    draggedIdRef.current = null
    lastHoverKeyRef.current = null
    setDraggedId(null)
  }

  /** Reorders live as the cursor moves -- called on every dragover, not just
   * on drop. `hoveredId` null means "the move-to-end zone". */
  function handleDragOver(hoveredId: string | null, insertAfter: boolean) {
    const dragged = draggedIdRef.current
    if (!dragged || dragged === hoveredId) return

    const key = `${hoveredId ?? ''}:${insertAfter}`
    if (key === lastHoverKeyRef.current) return
    lastHoverKeyRef.current = key

    setWorkingList((prev) => reorderList(prev, dragged, hoveredId, insertAfter))
    setSaveMessage(null)
  }

  /** Up/down buttons -- an alternative to drag-and-drop for a precise
   * one-spot move, reusing reorderList with the immediate neighbor as the
   * hover target rather than any new reorder logic. */
  function moveUp(index: number) {
    if (index <= 0) return
    const current = workingList[index]
    const previous = workingList[index - 1]
    setWorkingList((prev) =>
      reorderList(
        prev,
        current.platform_player_id,
        previous.platform_player_id,
        false,
      ),
    )
    setSaveMessage(null)
  }

  function moveDown(index: number) {
    if (index >= workingList.length - 1) return
    const current = workingList[index]
    const next = workingList[index + 1]
    setWorkingList((prev) =>
      reorderList(
        prev,
        current.platform_player_id,
        next.platform_player_id,
        true,
      ),
    )
    setSaveMessage(null)
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
                <th>Move</th>
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
                  onDragOver={(e) => {
                    e.preventDefault()
                    const rect = e.currentTarget.getBoundingClientRect()
                    const insertAfter = isBelowMidpoint(e.clientY, rect)
                    handleDragOver(row.platform_player_id, insertAfter)
                  }}
                  onDrop={(e) => {
                    e.preventDefault()
                    endDrag()
                  }}
                >
                  <td>{index + 1}</td>
                  <td>{row.adp !== null ? row.adp.toFixed(1) : '—'}</td>
                  <td>
                    <PositionTag position={row.position} />
                    <span className="player-name">{row.name}</span>
                  </td>
                  <td>{row.team ?? '—'}</td>
                  <td className="rankings-move-cell">
                    <button
                      type="button"
                      className="rankings-move-btn"
                      onClick={() => moveUp(index)}
                      disabled={index === 0}
                      aria-label={`Move ${row.name} up`}
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      className="rankings-move-btn"
                      onClick={() => moveDown(index)}
                      disabled={index === workingList.length - 1}
                      aria-label={`Move ${row.name} down`}
                    >
                      ▼
                    </button>
                  </td>
                </tr>
              ))}
              <tr
                className="rankings-end-zone"
                onDragOver={(e) => {
                  e.preventDefault()
                  handleDragOver(null, false)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  endDrag()
                }}
              >
                <td colSpan={5}>Drop here to move to the end</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
