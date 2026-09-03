import { useEffect, useMemo, useReducer, useState } from 'react'

import {
  fetchAvailableSources,
  fetchRankPool,
  type AvailableSource,
  type RankPool,
} from '../../api/rankPool'
import {
  createRankSet,
  fetchRanksForSet,
  fetchRankSets,
  saveRanksForSet,
  type RankSetSummary,
} from '../../api/ranks'
import type { SupportedPlatform } from '../../components/PlatformTabs'
import type { PoolPlayer } from '../../api/rankPool'
import { summarizeCandidates } from '../../lib/consensus'
import { BUILD_POSITIONS, SEASON, type BuildPosition } from '../../lib/formats'
import {
  buildReducer,
  initialBuildState,
  nextSlot,
  tiersForOrder,
} from '../../lib/rankBuilder'
import { moveInOrder, reconcileOrder, sortByOrder } from '../../lib/sourceOrder'
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

/** A starting point for a fresh set's name, not the final word -- the input
 * next to "+ New rank set..." is what actually lets you change it. Without an
 * editable field here, this guess was the *only* name a new set could get,
 * which meant a second QB build could never save: the guess collided with
 * whatever "My QBs" you'd already built, and there was nowhere to fix it. */
function defaultRankSetName(scope: Scope): string {
  return scope === 'overall' ? 'Built list' : `My ${scope}s`
}

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
  // null = no explicit choice yet, so the default logic below picks the
  // first existing set for this scope (or 'new' when there isn't one).
  // 'new' is a real, distinct choice -- it used to collapse onto "no choice",
  // which meant picking "New rank set..." from the dropdown silently fell
  // back to editing whatever set already existed for the scope.
  const [targetChoice, setTargetChoice] = useState<number | 'new' | null>(null)
  // Only meaningful while effectiveTarget === 'new'; reset to a fresh guess
  // whenever scope changes or "+ New rank set..." is (re-)selected, so it
  // never carries a stale name from a different scope into a save.
  const [newSetName, setNewSetName] = useState(() =>
    defaultRankSetName('overall'),
  )
  // A loaded rank set already carries name/position/team on every row, so the
  // working list can show them without depending on whichever sources happen
  // to be selected right now -- a player in your own list who isn't covered
  // by the current source selection would otherwise render as a bare id.
  const [knownPlayers, setKnownPlayers] = useState<Map<string, PoolPlayer>>(
    new Map(),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  // A personal priority order over sources -- independent of which are
  // checked, and remembered across visits so it doesn't need resetting every
  // time. Keyed per platform/format since the available sources differ per
  // scope; BuildPage remounts on either changing (see RankingsSection), so
  // reading it once here in the initializer is enough -- no effect needed to
  // react to a change that would unmount this component anyway.
  const sourceOrderKey = `fantasy-draft-app:sourceOrder:${platform}:${format}`
  const [sourceOrder, setSourceOrder] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(sourceOrderKey)
      if (!raw) return []
      const parsed: unknown = JSON.parse(raw)
      return Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')
        ? parsed
        : []
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(sourceOrderKey, JSON.stringify(sourceOrder))
    } catch {
      // private mode / storage disabled -- the order just won't be remembered
    }
  }, [sourceOrder, sourceOrderKey])

  function moveSource(ref: string, direction: 'up' | 'down') {
    setSourceOrder((prev) => moveInOrder(prev, ref, direction))
  }

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
        // A freshly imported dataset or newly built rank set joins at the
        // back of the priority order rather than resetting it.
        setSourceOrder((prev) =>
          reconcileOrder(
            prev,
            sources.map((s) => s.ref),
          ),
        )
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

  // The picker's row order and the candidate table's column order both come
  // from the same priority list, so dragging a source up here is exactly
  // what moves its column left there.
  const orderedAvailable = useMemo(
    () => sortByOrder(available, sourceOrder, (s) => s.ref),
    [available, sourceOrder],
  )
  const orderedActiveSources = useMemo(
    () =>
      activePool
        ? sortByOrder(activePool.sources, sourceOrder, (s) => s.ref)
        : [],
    [activePool, sourceOrder],
  )

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
    // The pool is authoritative when it has an opinion (fresher ranks/ADP);
    // knownPlayers only fills in identity for a player the current source
    // selection doesn't cover.
    const map = new Map<string, PoolPlayer>(knownPlayers)
    for (const player of activePool?.players ?? []) {
      map.set(player.platform_player_id, player)
    }
    return map
  }, [activePool, knownPlayers])

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

  const effectiveTarget = targetChoice ?? targetSets[0]?.id ?? 'new'

  // Loads an existing target set's saved order into the working list, so
  // "My QBs" showing in this dropdown actually means something -- it used to
  // just be where a save would land, with nothing ever loading its contents,
  // which is why a set you'd already built looked empty here.
  async function loadTarget(setId: number) {
    setError(null)
    try {
      const rows = await fetchRanksForSet(setId)
      setKnownPlayers((prev) => {
        const next = new Map(prev)
        for (const row of rows) {
          next.set(row.platform_player_id, {
            platform_player_id: row.platform_player_id,
            name: row.name,
            position: row.position,
            team: row.team,
            adp: row.adp,
            ranks: {},
          })
        }
        return next
      })
      const breaks: Record<string, 'major' | 'minor'> = {}
      const flags: Record<string, 'target' | 'fade'> = {}
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i]
        if (row.flag) flags[row.platform_player_id] = row.flag
        // A saved list keys tiers by number, not by an explicit break -- the
        // divider belongs on whichever player the tier changes after.
        const prior = rows[i - 1]
        if (prior && prior.tier !== null && row.tier !== prior.tier) {
          breaks[prior.platform_player_id] = prior.break_after ?? 'minor'
        }
      }
      dispatch({
        type: 'reset',
        order: rows.map((r) => r.platform_player_id),
        breaks,
        flags,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rank set')
    }
  }

  // Loads automatically on mount and on a scope switch, when a set for that
  // scope already exists -- not on every render, and not fighting a pick
  // that's already in progress.
  const [autoLoadedFor, setAutoLoadedFor] = useState<string | null>(null)
  useEffect(() => {
    if (typeof effectiveTarget !== 'number') return
    const key = `${scope}:${effectiveTarget}`
    if (autoLoadedFor === key) return
    setAutoLoadedFor(key)
    void loadTarget(effectiveTarget)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadTarget closes
    // over dispatch, which useReducer guarantees is stable.
  }, [scope, effectiveTarget, autoLoadedFor])

  function handleTargetChange(next: number | 'new') {
    // Switching to a different existing list while you have unsaved picks
    // would silently throw them away -- this is the one place in the builder
    // that can discard work outright, so it's the one place worth a native
    // confirm() rather than the app's usual two-click inline pattern.
    if (
      state.dirty &&
      !window.confirm(
        'Switch lists? Your unsaved picks in the current list will be lost.',
      )
    ) {
      return
    }
    setTargetChoice(next)
    setSaveMessage(null)
    if (next === 'new') {
      dispatch({ type: 'reset', order: [] })
      setAutoLoadedFor(`${scope}:new`)
      setNewSetName(defaultRankSetName(scope))
    } else {
      setAutoLoadedFor(null) // lets the effect above load it
    }
  }

  async function handleSave() {
    if (effectiveTarget === 'new' && newSetName.trim() === '') {
      setError('Give the new rank set a name')
      return
    }
    setSaving(true)
    setError(null)
    try {
      let setId = typeof effectiveTarget === 'number' ? effectiveTarget : null
      if (setId === null) {
        const created = await createRankSet({
          name: newSetName.trim(),
          season: SEASON,
          format,
          platform,
          scope,
          seed_from_adp: false,
        })
        setId = created.id
        setRankSets((sets) => [...sets, created])
        setTargetChoice(created.id)
        setAutoLoadedFor(`${scope}:${created.id}`)
      }
      const tiers = tiersForOrder(state.order, state.breaks)
      const result = await saveRanksForSet(
        setId,
        state.order.map((id, i) => ({
          platform_player_id: id,
          tier: tiers[i],
          break_after: state.breaks[id] ?? null,
          flag: state.flags[id] ?? null,
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
                if (
                  state.dirty &&
                  !window.confirm(
                    'Switch positions? Your unsaved picks will be lost.',
                  )
                ) {
                  return
                }
                setScope(value)
                setTargetChoice(null)
                setSaveMessage(null)
                dispatch({ type: 'reset', order: [] })
                setNewSetName(defaultRankSetName(value))
              }}
            >
              {value === 'overall' ? 'Overall' : value}
            </button>
          ))}
        </div>

        <select
          value={effectiveTarget}
          aria-label="Rank set"
          onChange={(e) =>
            handleTargetChange(
              e.target.value === 'new' ? 'new' : Number(e.target.value),
            )
          }
        >
          <option value="new">+ New rank set…</option>
          {targetSets.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        {effectiveTarget === 'new' && (
          <input
            className="build-new-set-name"
            value={newSetName}
            onChange={(e) => setNewSetName(e.target.value)}
            aria-label="New rank set name"
            placeholder="Name this rank set"
          />
        )}

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || state.order.length === 0}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() =>
            dispatch({
              type: 'setTierBreak',
              afterPlayerId: state.order[state.order.length - 1],
              strength: 'minor',
            })
          }
          disabled={state.order.length === 0}
          title="Start a new tier after the last player you picked"
        >
          + Tier break
        </button>
        <button
          type="button"
          onClick={() =>
            dispatch({
              type: 'setTierBreak',
              afterPlayerId: state.order[state.order.length - 1],
              strength: 'major',
            })
          }
          disabled={state.order.length === 0}
          title="A hard drop-off after the last player you picked"
        >
          + Big break
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
          sources={orderedAvailable}
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
          onMove={moveSource}
        />

        <BuildWorkingList
          order={state.order}
          breaks={state.breaks}
          flags={state.flags}
          insertAt={state.insertAt}
          playersById={playersById}
          scope={scope}
          onRemove={(playerId) => dispatch({ type: 'remove', playerId })}
          onReorder={(draggedId, hoveredId, insertAfter) =>
            dispatch({ type: 'reorder', draggedId, hoveredId, insertAfter })
          }
          onSetTierBreak={(afterPlayerId, strength) =>
            dispatch({ type: 'setTierBreak', afterPlayerId, strength })
          }
          onSetFlag={(playerId, flag) =>
            dispatch({ type: 'setFlag', playerId, flag })
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
            sources={orderedActiveSources}
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
