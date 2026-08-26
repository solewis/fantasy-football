/** Build-state reducer: the order you're constructing, plus undo.
 *
 * Tier breaks are keyed by the player id they follow, never by index. An
 * insert above a break shifts every index below it, and undo restores the
 * order but not shifted indices -- index-keyed breaks drift silently. Keying
 * by id is immune to both, and removing a player naturally drops its break.
 */

import { reorderList } from './reorder'

export interface BuildSnapshot {
  order: string[]
  breakAfterIds: string[]
}

export interface BuildState extends BuildSnapshot {
  /** Where the next pick lands; null means append at the end. */
  insertAt: number | null
  past: BuildSnapshot[]
  dirty: boolean
}

export type BuildAction =
  | { type: 'pick'; playerId: string }
  | { type: 'remove'; playerId: string }
  | {
      type: 'reorder'
      draggedId: string
      hoveredId: string | null
      insertAfter: boolean
    }
  | { type: 'toggleTierBreak'; afterPlayerId: string }
  | { type: 'setInsertAt'; index: number | null }
  | { type: 'undo' }
  | { type: 'reset'; order: string[]; breakAfterIds?: string[] }
  | { type: 'markSaved' }

/** Snapshots rather than inverse operations: for a few hundred string ids the
 * memory is nothing, and it stays trivially correct across pick, reorder,
 * tier-break and insert-at, each of which would otherwise need its own
 * inverse. */
export const MAX_UNDO = 50

export function initialBuildState(
  order: string[] = [],
  breakAfterIds: string[] = [],
): BuildState {
  return { order, breakAfterIds, insertAt: null, past: [], dirty: false }
}

export function nextSlot(state: BuildState): number {
  return (state.insertAt ?? state.order.length) + 1
}

function snapshot(state: BuildState): BuildSnapshot {
  return { order: state.order, breakAfterIds: state.breakAfterIds }
}

function push(state: BuildState, next: BuildSnapshot): BuildState {
  return {
    ...state,
    ...next,
    past: [...state.past, snapshot(state)].slice(-MAX_UNDO),
    dirty: true,
  }
}

export function buildReducer(
  state: BuildState,
  action: BuildAction,
): BuildState {
  switch (action.type) {
    case 'pick': {
      if (state.order.includes(action.playerId)) return state
      const at = state.insertAt ?? state.order.length
      const order = [...state.order]
      order.splice(at, 0, action.playerId)
      return {
        ...push(state, { order, breakAfterIds: state.breakAfterIds }),
        // Stepping the insertion point keeps a run of inserts going in order
        // rather than reversing them.
        insertAt: state.insertAt === null ? null : at + 1,
      }
    }

    case 'remove': {
      if (!state.order.includes(action.playerId)) return state
      return push(state, {
        order: state.order.filter((id) => id !== action.playerId),
        breakAfterIds: state.breakAfterIds.filter(
          (id) => id !== action.playerId,
        ),
      })
    }

    case 'reorder': {
      if (action.draggedId === action.hoveredId) return state
      // reorderList works on objects with a platform_player_id; adapting here
      // rather than changing it keeps the Edit view's drag behaviour -- and
      // its same-array-reference no-op, which the dragover dedupe relies on --
      // completely untouched.
      const next = reorderList(
        state.order.map((id) => ({ platform_player_id: id })),
        action.draggedId,
        action.hoveredId,
        action.insertAfter,
      ).map((o) => o.platform_player_id)

      if (next.length === state.order.length) {
        const unchanged = next.every((id, i) => id === state.order[i])
        if (unchanged) return state
      }
      return push(state, { order: next, breakAfterIds: state.breakAfterIds })
    }

    case 'toggleTierBreak': {
      const has = state.breakAfterIds.includes(action.afterPlayerId)
      return push(state, {
        order: state.order,
        breakAfterIds: has
          ? state.breakAfterIds.filter((id) => id !== action.afterPlayerId)
          : [...state.breakAfterIds, action.afterPlayerId],
      })
    }

    case 'setInsertAt':
      return { ...state, insertAt: action.index }

    case 'undo': {
      if (state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      return {
        ...state,
        ...previous,
        past: state.past.slice(0, -1),
        dirty: true,
      }
    }

    case 'reset':
      return initialBuildState(action.order, action.breakAfterIds ?? [])

    case 'markSaved':
      return { ...state, dirty: false }
  }
}

/** Tier numbers implied by the break positions, one per player in order. */
export function tiersForOrder(
  order: string[],
  breakAfterIds: string[],
): (number | null)[] {
  if (breakAfterIds.length === 0) return order.map(() => null)
  const breaks = new Set(breakAfterIds)
  let tier = 1
  return order.map((id) => {
    const current = tier
    if (breaks.has(id)) tier += 1
    return current
  })
}
