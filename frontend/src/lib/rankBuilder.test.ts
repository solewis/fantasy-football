import { describe, expect, it } from 'vitest'

import {
  buildReducer,
  initialBuildState,
  MAX_UNDO,
  nextSlot,
  tiersForOrder,
  type BuildState,
} from './rankBuilder'

function build(...ids: string[]): BuildState {
  return ids.reduce(
    (state, playerId) => buildReducer(state, { type: 'pick', playerId }),
    initialBuildState(),
  )
}

describe('picking', () => {
  it('appends and advances the slot', () => {
    const state = build('a', 'b')

    expect(state.order).toEqual(['a', 'b'])
    expect(nextSlot(state)).toBe(3)
    expect(state.dirty).toBe(true)
  })

  it('ignores a player already in the list', () => {
    const state = buildReducer(build('a'), { type: 'pick', playerId: 'a' })

    expect(state.order).toEqual(['a'])
  })

  it('splices at insertAt and keeps a run of inserts in order', () => {
    let state = build('a', 'b', 'c')
    state = buildReducer(state, { type: 'setInsertAt', index: 1 })
    state = buildReducer(state, { type: 'pick', playerId: 'x' })
    state = buildReducer(state, { type: 'pick', playerId: 'y' })

    expect(state.order).toEqual(['a', 'x', 'y', 'b', 'c'])
  })
})

describe('undo', () => {
  it('restores the previous order exactly', () => {
    const before = build('a', 'b')
    const after = buildReducer(before, { type: 'pick', playerId: 'c' })

    const undone = buildReducer(after, { type: 'undo' })

    expect(undone.order).toEqual(before.order)
  })

  it('is a no-op past the start', () => {
    const state = buildReducer(initialBuildState(), { type: 'undo' })

    expect(state.order).toEqual([])
  })

  it('restores tier breaks too', () => {
    let state = build('a', 'b')
    state = buildReducer(state, {
      type: 'setTierBreak',
      afterPlayerId: 'a',
      strength: 'minor',
    })
    const withBreak = state.breaks
    state = buildReducer(state, { type: 'pick', playerId: 'c' })

    const undone = buildReducer(state, { type: 'undo' })

    expect(undone.breaks).toEqual(withBreak)
  })

  it('caps its history', () => {
    let state = initialBuildState()
    for (let i = 0; i < MAX_UNDO + 10; i += 1) {
      state = buildReducer(state, { type: 'pick', playerId: `p${i}` })
    }

    expect(state.past.length).toBe(MAX_UNDO)
  })
})

describe('tier breaks', () => {
  it('survive an insert above them', () => {
    // The reason breaks are keyed by player id and never by index: an insert
    // above a break shifts every index below it, and undo restores the order
    // but not shifted indices.
    let state = build('a', 'b', 'c')
    state = buildReducer(state, {
      type: 'setTierBreak',
      afterPlayerId: 'b',
      strength: 'major',
    })
    state = buildReducer(state, { type: 'setInsertAt', index: 0 })
    state = buildReducer(state, { type: 'pick', playerId: 'x' })

    expect(state.order).toEqual(['x', 'a', 'b', 'c'])
    expect(state.breaks).toEqual({ b: 'major' })
    expect(tiersForOrder(state.order, state.breaks)).toEqual([1, 1, 1, 2])
  })

  it('drop when their player is removed', () => {
    let state = build('a', 'b')
    state = buildReducer(state, {
      type: 'setTierBreak',
      afterPlayerId: 'a',
      strength: 'minor',
    })

    state = buildReducer(state, { type: 'remove', playerId: 'a' })

    expect(state.breaks).toEqual({})
  })

  it('clear when set to null', () => {
    let state = build('a')
    state = buildReducer(state, {
      type: 'setTierBreak',
      afterPlayerId: 'a',
      strength: 'minor',
    })
    state = buildReducer(state, {
      type: 'setTierBreak',
      afterPlayerId: 'a',
      strength: null,
    })

    expect(state.breaks).toEqual({})
  })

  it('carry a weight, and both weights start a new tier', () => {
    // The weights describe how big the drop is, not whether one happened.
    let state = build('a', 'b', 'c')
    state = buildReducer(state, {
      type: 'setTierBreak',
      afterPlayerId: 'a',
      strength: 'minor',
    })
    state = buildReducer(state, {
      type: 'setTierBreak',
      afterPlayerId: 'b',
      strength: 'major',
    })

    expect(state.breaks).toEqual({ a: 'minor', b: 'major' })
    expect(tiersForOrder(state.order, state.breaks)).toEqual([1, 2, 3])
  })
})

describe('flags', () => {
  it('set, change and clear', () => {
    let state = build('a')

    state = buildReducer(state, {
      type: 'setFlag',
      playerId: 'a',
      flag: 'target',
    })
    expect(state.flags).toEqual({ a: 'target' })

    state = buildReducer(state, {
      type: 'setFlag',
      playerId: 'a',
      flag: 'fade',
    })
    expect(state.flags).toEqual({ a: 'fade' })

    state = buildReducer(state, { type: 'setFlag', playerId: 'a', flag: null })
    expect(state.flags).toEqual({})
  })

  it('drop when their player is removed', () => {
    let state = build('a', 'b')
    state = buildReducer(state, {
      type: 'setFlag',
      playerId: 'a',
      flag: 'target',
    })

    state = buildReducer(state, { type: 'remove', playerId: 'a' })

    expect(state.flags).toEqual({})
  })

  it('survive a reorder', () => {
    let state = build('a', 'b', 'c')
    state = buildReducer(state, {
      type: 'setFlag',
      playerId: 'c',
      flag: 'target',
    })

    state = buildReducer(state, {
      type: 'reorder',
      draggedId: 'c',
      hoveredId: 'a',
      insertAfter: false,
    })

    expect(state.order).toEqual(['c', 'a', 'b'])
    expect(state.flags).toEqual({ c: 'target' })
  })

  it('are restored by undo', () => {
    let state = build('a')
    state = buildReducer(state, {
      type: 'setFlag',
      playerId: 'a',
      flag: 'target',
    })

    state = buildReducer(state, { type: 'undo' })

    expect(state.flags).toEqual({})
  })
})

describe('tiersForOrder', () => {
  it('is all null with no breaks', () => {
    expect(tiersForOrder(['a', 'b'], {})).toEqual([null, null])
  })

  it('numbers tiers from the breaks', () => {
    expect(
      tiersForOrder(['a', 'b', 'c', 'd'], { a: 'major', c: 'minor' }),
    ).toEqual([1, 2, 2, 3])
  })
})

describe('reorder', () => {
  it('moves a player and is a no-op onto itself', () => {
    const state = build('a', 'b', 'c')

    const moved = buildReducer(state, {
      type: 'reorder',
      draggedId: 'c',
      hoveredId: 'a',
      insertAfter: false,
    })
    expect(moved.order).toEqual(['c', 'a', 'b'])

    const same = buildReducer(state, {
      type: 'reorder',
      draggedId: 'a',
      hoveredId: 'a',
      insertAfter: false,
    })
    expect(same).toBe(state)
  })
})

describe('save state', () => {
  it('clears dirty on markSaved', () => {
    const state = buildReducer(build('a'), { type: 'markSaved' })

    expect(state.dirty).toBe(false)
  })
})
