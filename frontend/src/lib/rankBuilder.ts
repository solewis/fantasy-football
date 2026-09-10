/** Build-state reducer: the order you're constructing, plus undo.
 *
 * Tier breaks and flags are keyed by the player id they attach to, never by
 * index. An insert above a break shifts every index below it, and undo
 * restores the order but not shifted indices -- index-keyed marks drift
 * silently. Keying by id is immune to both, and removing a player naturally
 * drops its marks.
 */

import { reorderList } from './reorder'

/** How hard the drop-off is after a player. Both start a new tier; they differ
 * in how sharp the cliff is, which is what you actually want to see on the
 * clock. */
export type BreakStrength = 'major' | 'minor'

/** A personal lean that rank order alone can't express -- "I'll reach for
 * him", "I'd rather not". */
export type PlayerFlag = 'target' | 'fade'

export interface BuildSnapshot {
  order: string[]
  breaks: Record<string, BreakStrength>
  flags: Record<string, PlayerFlag>
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
  | {
      type: 'setTierBreak'
      afterPlayerId: string
      /** null clears the break. */
      strength: BreakStrength | null
    }
  | {
      type: 'setFlag'
      playerId: string
      /** null clears the flag. */
      flag: PlayerFlag | null
    }
  | { type: 'setInsertAt'; index: number | null }
  | { type: 'undo' }
  | {
      type: 'reset'
      order: string[]
      breaks?: Record<string, BreakStrength>
      flags?: Record<string, PlayerFlag>
    }
  | { type: 'markSaved' }

/** Snapshots rather than inverse operations: for a few hundred string ids the
 * memory is nothing, and it stays trivially correct across pick, reorder,
 * tier-break and insert-at, each of which would otherwise need its own
 * inverse. */
export const MAX_UNDO = 50

export function initialBuildState(
  order: string[] = [],
  breaks: Record<string, BreakStrength> = {},
  flags: Record<string, PlayerFlag> = {},
): BuildState {
  return { order, breaks, flags, insertAt: null, past: [], dirty: false }
}

export function nextSlot(state: BuildState): number {
  return (state.insertAt ?? state.order.length) + 1
}

function snapshot(state: BuildState): BuildSnapshot {
  return { order: state.order, breaks: state.breaks, flags: state.flags }
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
        ...push(state, { ...snapshot(state), order }),
        // Stepping the insertion point keeps a run of inserts going in order
        // rather than reversing them.
        insertAt: state.insertAt === null ? null : at + 1,
      }
    }

    case 'remove': {
      if (!state.order.includes(action.playerId)) return state
      const { [action.playerId]: _break, ...breaks } = state.breaks
      const { [action.playerId]: _flag, ...flags } = state.flags
      return push(state, {
        order: state.order.filter((id) => id !== action.playerId),
        breaks,
        flags,
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
      return push(state, { ...snapshot(state), order: next })
    }

    case 'setTierBreak': {
      const breaks = { ...state.breaks }
      if (action.strength === null) delete breaks[action.afterPlayerId]
      else breaks[action.afterPlayerId] = action.strength
      return push(state, { ...snapshot(state), breaks })
    }

    case 'setFlag': {
      const flags = { ...state.flags }
      if (action.flag === null) delete flags[action.playerId]
      else flags[action.playerId] = action.flag
      return push(state, { ...snapshot(state), flags })
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
      return initialBuildState(action.order, action.breaks, action.flags)

    case 'markSaved':
      return { ...state, dirty: false }
  }
}

/** Tier numbers implied by the break positions, one per player in order.
 *
 * Both break weights increment the tier -- they describe how big the drop is,
 * not whether one happened. */
export function tiersForOrder(
  order: string[],
  breaks: Record<string, BreakStrength>,
): (number | null)[] {
  if (Object.keys(breaks).length === 0) return order.map(() => null)
  let tier = 1
  return order.map((id) => {
    const current = tier
    if (breaks[id]) tier += 1
    return current
  })
}
