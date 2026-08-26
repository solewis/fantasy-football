import { useEffect, useMemo, useReducer, useState } from 'react'

import {
  fetchAvailableSources,
  fetchRankPool,
  type AvailableSource,
  type RankPool,
} from '../../api/rankPool'
import {
  createRankSet,
  fetchRankSets,
  saveRanksForSet,
  type RankSetSummary,
} from '../../api/ranks'
import type { SupportedPlatform } from '../../components/PlatformTabs'
import { summarizeCandidates } from '../../lib/consensus'
import { BUILD_POSITIONS, SEASON, type BuildPosition } from '../../lib/formats'
import {
  buildReducer,
  initialBuildState,
  nextSlot,
  tiersForOrder,
} from '../../lib/rankBuilder'
import { BuildCandidateTable } from './BuildCandidateTable'
import { BuildPositionalNextUp } from './BuildPositionalNextUp'
import { BuildSourcePicker } from './BuildSourcePicker'
import { BuildWorkingList } from './BuildWorkingList'
import './build.css'

interface BuildPageProps {
  platform: SupportedPlatform
  format: string
}

type Scope = 'overall' | BuildPosition

/** Build a rank list against what other sources think.
 *
 * The tool never picks. It shows what each selected source says about the next
 * few candidates and gets out of the way; the ordering is by average rank
 * because that's a sort, not a recommendation.
 *
 * The whole pool arrives in one request and every delta recomputes locally on
 * each pick, so the loop is click-click-click with no round trips.
 */
export function BuildPage({ platform, format }: BuildPageProps) {
  const [scope, setScope] = useState<Scope>('overall')
  // Everything loaded is selected by default. You imported a ranking file in
  // order to compare against it, and the previous default (ADP only) meant a
  // freshly imported dataset sat unchecked in the rail while the table showed
  // a single column -- which reads as "my import didn't work".
  const [selectedRefs, setSelectedRefs] = useState<string[]>(['adp'])
  const [available, setAvailable] = useState<AvailableSource[]>([])
  const [pool, setPool] = useState<RankPool | null>(null)
  const [rankSets, setRankSets] = useState<RankSetSummary[]>([])
  const [targetSetId, setTargetSetId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const [state, dispatch] = useReducer(buildReducer, undefined, () =>
    initialBuildState(),
  )

  // Effect C: which sources exist. Never touches the pool.
  const [sourcesLoadedKey, setSourcesLoadedKey] = useState<string | null>(null)
  const sourcesLoaded = sourcesLoadedKey === `${platform}:${format}`

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchAvailableSources({ platform, season: SEASON, format }),
      fetchRankSets({ platform, season: SEASON, format }),
    ])
      .then(([sources, sets]) => {
        if (cancelled) return
        setAvailable(sources)
        setRankSets(sets)
        setSelectedRefs(sources.map((s) => s.ref))
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(
            err instanceof Error ? err.message : 'Failed to load sources',
          )
      })
      .finally(() => {
        if (!cancelled) setSourcesLoadedKey(`${platform}:${format}`)
      })
    return () => {
      cancelled = true
    }
  }, [platform, format])

  // A source that can't serve the current axis is deselected rather than
  // silently sent -- the backend would (correctly) reject the whole request.
  const eligibleRefs = useMemo(() => {
    const usable = new Set(
      available
        .filter((s) =>
          scope === 'overall' ? s.supports_overall : s.supports_positional,
        )
        .map((s) => s.ref),
    )
    return selectedRefs.filter((ref) => usable.has(ref))
  }, [available, scope, selectedRefs])

  // A stable string, not the array: an array's identity changes every render
  // and the effect would re-fire forever.
  const refsKey = [...eligibleRefs].sort().join(',')
  const poolKey = `${platform}:${format}:${scope}:${refsKey}`
  const [poolLoadedKey, setPoolLoadedKey] = useState<string | null>(null)

  // Effect D: the candidate pool. Gated on C, so we never build a table from a
  // half-loaded source list.
  useEffect(() => {
    if (!sourcesLoaded || eligibleRefs.length === 0) return
    let cancelled = false
    fetchRankPool({
      platform,
      season: SEASON,
      format,
      scope,
      sourceRefs: eligibleRefs,
    })
      .then((result) => {
        if (!cancelled) {
          setPool(result)
          setError(null)
        }
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : 'Failed to load pool')
      })
      .finally(() => {
        if (!cancelled) setPoolLoadedKey(poolKey)
      })
    return () => {
      cancelled = true
    }
  }, [sourcesLoaded, eligibleRefs, poolKey, platform, format, scope])

  const hasSources = eligibleRefs.length > 0
  const loading = !sourcesLoaded || (hasSources && poolLoadedKey !== poolKey)
  // Derived rather than cleared in an effect: with nothing selected there is
  // no pool, and the last one shouldn't linger on screen.
  const activePool = hasSources ? pool : null
  const placed = useMemo(() => new Set(state.order), [state.order])
  const slot = nextSlot(state)
  const slotLabel = scope === 'overall' ? `#${slot}` : `${scope}${slot}`

  const candidates = useMemo(
    () =>
      activePool
        ? summarizeCandidates(activePool.players, eligibleRefs, placed)
        : [],
    [activePool, eligibleRefs, placed],
  )

  const playersById = useMemo(() => {
    const map = new Map<string, RankPool['players'][number]>()
    for (const player of activePool?.players ?? []) {
      map.set(player.platform_player_id, player)
    }
    return map
  }, [activePool])

  // Only overall builds have a "yours" panel; positional sets ARE the thing
  // being built when scope is a position.
  const positionalSets = useMemo(
    () => rankSets.filter((s) => s.scope !== 'overall'),
    [rankSets],
  )

  // An explicit choice wins; otherwise fall back to the first set for this
  // scope. Derived so switching scope can't leave a stale selection behind.
  const targetSets = useMemo(
    () => rankSets.filter((s) => s.scope === scope),
    [rankSets, scope],
  )

  const effectiveTargetSetId = targetSetId ?? targetSets[0]?.id ?? null

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      let setId = effectiveTargetSetId
      if (setId === null) {
        const created = await createRankSet({
          name: scope === 'overall' ? 'Built list' : `My ${scope}s`,
          season: SEASON,
          format,
          platform,
          scope,
          seed_from_adp: false,
        })
        setId = created.id
        setRankSets((sets) => [...sets, created])
        setTargetSetId(created.id)
      }
      const tiers = tiersForOrder(state.order, state.breakAfterIds)
      const result = await saveRanksForSet(
        setId,
        state.order.map((id, i) => ({
          platform_player_id: id,
          tier: tiers[i],
        })),
      )
      dispatch({ type: 'markSaved' })
      setSaveMessage(`Saved ${result.count} ranks`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="build-page">
      <div className="build-toolbar">
        <div
          className="build-scope-tabs"
          role="tablist"
          aria-label="Build scope"
        >
          {(['overall', ...BUILD_POSITIONS] as Scope[]).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={scope === value}
              className={`build-scope-tab${scope === value ? ' active' : ''}`}
              onClick={() => {
                // Switching axis invalidates the list being built, so reset
                // here rather than in an effect watching scope.
                setScope(value)
                setTargetSetId(null)
                setSaveMessage(null)
                dispatch({ type: 'reset', order: [] })
              }}
            >
              {value === 'overall' ? 'Overall' : value}
            </button>
          ))}
        </div>

        <select
          value={effectiveTargetSetId ?? ''}
          aria-label="Save to rank set"
          onChange={(e) =>
            setTargetSetId(
              e.target.value === '' ? null : Number(e.target.value),
            )
          }
        >
          <option value="">New rank set…</option>
          {targetSets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || state.order.length === 0}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => dispatch({ type: 'undo' })}
          disabled={state.past.length === 0}
        >
          Undo
        </button>
        {saveMessage && (
          <span className="rankings-save-message">{saveMessage}</span>
        )}
      </div>

      {error && <p className="rankings-error">{error}</p>}

      <div className="build-grid">
        <BuildSourcePicker
          sources={available}
          selectedRefs={selectedRefs}
          eligibleCount={eligibleRefs.length}
          scope={scope}
          onToggle={(ref) =>
            setSelectedRefs((refs) =>
              refs.includes(ref)
                ? refs.filter((r) => r !== ref)
                : [...refs, ref],
            )
          }
        />

        <BuildWorkingList
          order={state.order}
          breakAfterIds={state.breakAfterIds}
          insertAt={state.insertAt}
          playersById={playersById}
          scope={scope}
          onRemove={(playerId) => dispatch({ type: 'remove', playerId })}
          onReorder={(draggedId, hoveredId, insertAfter) =>
            dispatch({ type: 'reorder', draggedId, hoveredId, insertAfter })
          }
          onToggleTierBreak={(afterPlayerId) =>
            dispatch({ type: 'toggleTierBreak', afterPlayerId })
          }
          onSetInsertAt={(index) => dispatch({ type: 'setInsertAt', index })}
        />

        <div className="build-right">
          {scope === 'overall' && positionalSets.length > 0 && (
            <BuildPositionalNextUp
              platform={platform}
              format={format}
              sets={positionalSets}
              placed={placed}
              onPick={(playerId) => dispatch({ type: 'pick', playerId })}
            />
          )}

          <BuildCandidateTable
            candidates={candidates}
            sources={activePool?.sources ?? []}
            slot={slot}
            slotLabel={slotLabel}
            loading={loading}
            emptyMessage={
              eligibleRefs.length === 0
                ? 'Pick at least one source that has ranks for this list.'
                : 'No candidates left.'
            }
            onPick={(playerId) => dispatch({ type: 'pick', playerId })}
          />
        </div>
      </div>
    </div>
  )
}
