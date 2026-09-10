import { useEffect, useRef, useState } from 'react'

import { fetchPlayers } from '../../api/players'
import {
  createRankSet,
  deleteRankSet,
  fetchRankSets,
  fetchRanksForSet,
  renameRankSet,
  saveRanksForSet,
  type RankRow,
  type RankSetSummary,
} from '../../api/ranks'
import type { SupportedPlatform } from '../../components/PlatformTabs'
import { FORMATS, SEASON } from '../../lib/formats'
import { reorderList } from '../../lib/reorder'
import { RankingsTable } from './RankingsTable'
import './rankings.css'

type Source = 'saved' | 'adp' | null

interface RankingsPageProps {
  platform: SupportedPlatform
  format: string
}

/** The Edit view: the drag-and-drop rank table.
 *
 * platform/format are props rather than state because all three Rankings
 * sub-views share them -- picking ESPN in Sources and then switching to Edit
 * should stay on ESPN. Everything below that (which set is open, the working
 * list, drag state) is local, since it means nothing to the other views.
 */
export function RankingsPage({ platform, format }: RankingsPageProps) {
  const [rankSets, setRankSets] = useState<RankSetSummary[]>([])
  const [selectedSetId, setSelectedSetId] = useState<number | null>(null)
  const [workingList, setWorkingList] = useState<RankRow[]>([])
  const [source, setSource] = useState<Source>(null)
  const [error, setError] = useState<string | null>(null)
  const [adpLoading, setAdpLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  // "loading" is deliberately derived, not a useState set from inside an
  // effect -- these two keys only get written from a .then()/.finally()
  // callback (an async continuation, not the effect's synchronous body), so
  // there's nothing to reset up front and no risk of a cascading render.
  const [rankSetsLoadedKey, setRankSetsLoadedKey] = useState<string | null>(
    null,
  )
  const rankSetsLoaded = rankSetsLoadedKey === `${platform}:${format}`
  const [ranksLoadedKey, setRanksLoadedKey] = useState<string | null>(null)
  const currentRanksKey = `${selectedSetId ?? 'adp'}:${platform}:${format}`
  const loading = !rankSetsLoaded || ranksLoadedKey !== currentRanksKey

  const [creatingName, setCreatingName] = useState<string | null>(null)
  const [renamingName, setRenamingName] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // State drives the "dragging" CSS highlight (fine to be a render behind);
  // the ref is what dragover/drop actually read, since those DOM events can
  // fire before React flushes a state update, and a stale closure there
  // would silently drop the reorder.
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const draggedIdRef = useRef<string | null>(null)
  // Skips redundant reorders (and re-renders) while the cursor sits still
  // within the same half of the same row -- dragover fires continuously.
  const lastHoverKeyRef = useRef<string | null>(null)

  const selectedSet = rankSets.find((s) => s.id === selectedSetId) ?? null
  // undefined (no filter) for an overall set; the scope itself for a
  // positional one. Without this, ADP order/fallback pulled every position
  // regardless of which set was open -- "Load from ADP" (or even just an
  // empty positional set falling back automatically) on "My QBs" replaced
  // its 29 quarterbacks with hundreds of players across every position, which
  // is indistinguishable from the whole list having been deleted.
  const selectedSetPosition =
    selectedSet && selectedSet.scope !== 'overall'
      ? selectedSet.scope
      : undefined

  // Effect A: the list of rank sets for this format. Never touches
  // workingList -- that's Effect B's job, keyed on selectedSetId, so the two
  // can't race each other on every format switch. rankSetsLoaded gates Effect
  // B so it never renders an ADP preview before we actually know whether a
  // rank set exists for this format -- without that gate, a brand-new format
  // switch briefly (and wrongly) shows ADP order while this fetch is still
  // in flight, racing against the real answer.
  useEffect(() => {
    let cancelled = false

    fetchRankSets({ platform, season: SEASON, format })
      .then((sets) => {
        if (cancelled) return
        setRankSets(sets)
        setSelectedSetId((current) => {
          if (current !== null && sets.some((s) => s.id === current))
            return current
          return sets.length > 0 ? sets[0].id : null
        })
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load rank sets',
          )
      })
      .finally(() => {
        if (!cancelled) setRankSetsLoadedKey(`${platform}:${format}`)
      })

    return () => {
      cancelled = true
    }
  }, [platform, format])

  // Effect B: the actual rank content for whichever set is selected (or an
  // ADP preview if none is). Waits for Effect A to finish at least once.
  useEffect(() => {
    if (!rankSetsLoaded) return
    let cancelled = false
    const key = `${selectedSetId ?? 'adp'}:${platform}:${format}`

    async function load() {
      if (selectedSetId === null) {
        const rows = await fetchPlayers({ platform, season: SEASON, format })
        if (cancelled) return
        setWorkingList(rows)
        setSource('adp')
        return
      }

      const rows = await fetchRanksForSet(selectedSetId)
      if (cancelled) return
      if (rows.length > 0) {
        setWorkingList(rows)
        setSource('saved')
        return
      }
      const adpRows = await fetchPlayers({
        platform,
        season: SEASON,
        format,
        position: selectedSetPosition,
      })
      if (cancelled) return
      setWorkingList(adpRows)
      setSource('adp')
    }

    load()
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load rankings',
          )
      })
      .finally(() => {
        if (!cancelled) setRanksLoadedKey(key)
      })

    return () => {
      cancelled = true
    }
    // platform/format are included so switching between two platforms or
    // formats that both have zero rank sets (selectedSetId staying null both
    // times) still refetches the ADP preview for the new scope, instead of
    // leaving the old one on screen.
  }, [selectedSetId, platform, format, rankSetsLoaded, selectedSetPosition])

  async function handleLoadFromAdp() {
    setAdpLoading(true)
    setError(null)
    setSaveMessage(null)
    try {
      const rows = await fetchPlayers({
        platform,
        season: SEASON,
        format,
        position: selectedSetPosition,
      })
      setWorkingList(rows)
      setSource('adp')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load ADP order')
    } finally {
      setAdpLoading(false)
    }
  }

  async function handleSave() {
    if (selectedSetId === null) return
    setSaving(true)
    setError(null)
    try {
      const result = await saveRanksForSet(
        selectedSetId,
        // break_after/flag ride along even though this view doesn't edit
        // them: the save is a full replace, so dropping them here would
        // silently wipe every tier break and target/fade the builder set.
        workingList.map((row) => ({
          platform_player_id: row.platform_player_id,
          tier: row.tier,
          break_after: row.break_after,
          flag: row.flag,
        })),
      )
      setSaveMessage(`Saved ${result.count} ranks`)
      setSource('saved')
      const sets = await fetchRankSets({ platform, season: SEASON, format })
      setRankSets(sets)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save ranks')
    } finally {
      setSaving(false)
    }
  }

  function startCreate() {
    setError(null)
    setRenamingName(null)
    setConfirmingDelete(false)
    const formatLabel = FORMATS.find((f) => f.value === format)?.label ?? format
    setCreatingName(`${formatLabel} Ranks`)
  }

  async function confirmCreate() {
    if (!creatingName || creatingName.trim() === '') return
    setError(null)
    try {
      const created = await createRankSet({
        name: creatingName,
        season: SEASON,
        format,
        platform,
        seed_from_adp: true,
      })
      setRankSets((prev) => [...prev, created])
      setSelectedSetId(created.id)
      setCreatingName(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create rank set')
    }
  }

  function startRename() {
    if (!selectedSet) return
    setError(null)
    setCreatingName(null)
    setConfirmingDelete(false)
    setRenamingName(selectedSet.name)
  }

  async function confirmRename() {
    if (selectedSetId === null || !renamingName || renamingName.trim() === '')
      return
    setError(null)
    try {
      const updated = await renameRankSet(selectedSetId, renamingName)
      setRankSets((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s)),
      )
      setRenamingName(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rename rank set')
    }
  }

  async function confirmDelete() {
    if (selectedSetId === null) return
    setError(null)
    try {
      await deleteRankSet(selectedSetId)
      const remaining = rankSets.filter((s) => s.id !== selectedSetId)
      setRankSets(remaining)
      setSelectedSetId(remaining.length > 0 ? remaining[0].id : null)
      setConfirmingDelete(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete rank set')
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
        {rankSets.length > 0 && (
          <select
            className="rankings-format"
            value={selectedSetId ?? ''}
            onChange={(e) => setSelectedSetId(Number(e.target.value))}
            aria-label="Rank set"
          >
            {rankSets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.scope === 'overall' ? s.name : `${s.name} · ${s.scope}`} (
                {s.player_count})
              </option>
            ))}
          </select>
        )}

        {creatingName !== null ? (
          <>
            <input
              className="rankings-format"
              value={creatingName}
              onChange={(e) => setCreatingName(e.target.value)}
              aria-label="New rank set name"
              autoFocus
            />
            <button type="button" onClick={confirmCreate}>
              Create
            </button>
            <button type="button" onClick={() => setCreatingName(null)}>
              Cancel
            </button>
          </>
        ) : renamingName !== null ? (
          <>
            <input
              className="rankings-format"
              value={renamingName}
              onChange={(e) => setRenamingName(e.target.value)}
              aria-label="Rename rank set"
              autoFocus
            />
            <button type="button" onClick={confirmRename}>
              Rename
            </button>
            <button type="button" onClick={() => setRenamingName(null)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={startCreate}>
              + New Rank Set
            </button>
            {selectedSet && (
              <button type="button" onClick={startRename}>
                Rename
              </button>
            )}
            {selectedSet &&
              (confirmingDelete ? (
                <>
                  <button type="button" onClick={confirmDelete}>
                    Confirm delete?
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Cancel
                  </button>
                </>
              ) : (
                <button type="button" onClick={() => setConfirmingDelete(true)}>
                  Delete
                </button>
              ))}
          </>
        )}

        <button type="button" onClick={handleLoadFromAdp} disabled={adpLoading}>
          Load from ADP
        </button>
        <button
          type="button"
          className="rankings-save"
          onClick={handleSave}
          disabled={
            saving || workingList.length === 0 || selectedSetId === null
          }
        >
          {saving ? 'Saving…' : 'Save Ranks'}
        </button>
        {saveMessage && (
          <span className="rankings-save-message">{saveMessage}</span>
        )}
      </div>

      {rankSets.length === 0 && (
        <p className="rankings-source-note">
          No rank sets for this format yet — create one to start saving.
        </p>
      )}

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
          <RankingsTable
            rows={workingList}
            draggedId={draggedId}
            onDragStartRow={startDrag}
            onDragEndRow={endDrag}
            onDragOverRow={handleDragOver}
            onMoveUp={moveUp}
            onMoveDown={moveDown}
          />
        )}
      </div>
    </div>
  )
}
