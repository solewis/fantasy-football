import { describe, expect, it } from 'vitest'

import { isBelowMidpoint, reorderList } from './reorder'

interface Item {
  platform_player_id: string
}

const ids = (list: Item[]) => list.map((item) => item.platform_player_id)

function makeList(...ids: string[]): Item[] {
  return ids.map((platform_player_id) => ({ platform_player_id }))
}

describe('reorderList', () => {
  it('moving onto the next row’s top half is a no-op (already right before it)', () => {
    const list = makeList('A', 'B', 'C', 'D')

    const result = reorderList(list, 'A', 'B', false)

    expect(ids(result)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('moving onto the next row’s bottom half moves exactly one spot down', () => {
    const list = makeList('A', 'B', 'C', 'D')

    const result = reorderList(list, 'A', 'B', true)

    expect(ids(result)).toEqual(['B', 'A', 'C', 'D'])
  })

  it('moving a later item onto an earlier row’s top half lands just before it', () => {
    const list = makeList('A', 'B', 'C', 'D')

    const result = reorderList(list, 'D', 'B', false)

    expect(ids(result)).toEqual(['A', 'D', 'B', 'C'])
  })

  it('moving a later item onto an earlier row’s bottom half lands just after it', () => {
    const list = makeList('A', 'B', 'C', 'D')

    const result = reorderList(list, 'D', 'B', true)

    expect(ids(result)).toEqual(['A', 'B', 'D', 'C'])
  })

  it('moving the previous row’s bottom half back onto it is a no-op', () => {
    const list = makeList('A', 'B', 'C', 'D')

    const result = reorderList(list, 'B', 'A', true)

    expect(ids(result)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('is a true no-op (same reference) when hovering the dragged row itself', () => {
    const list = makeList('A', 'B', 'C')

    const result = reorderList(list, 'B', 'B', false)

    expect(result).toBe(list)
  })

  it('returns the original list unchanged for an unknown dragged id', () => {
    const list = makeList('A', 'B', 'C')

    const result = reorderList(list, 'ZZZ', 'B', true)

    expect(result).toBe(list)
  })

  it('returns the original list unchanged for an unknown hovered id', () => {
    const list = makeList('A', 'B', 'C')

    const result = reorderList(list, 'A', 'ZZZ', true)

    expect(result).toBe(list)
  })

  it('moves an item to the very end when hoveredId is null', () => {
    const list = makeList('A', 'B', 'C', 'D')

    const result = reorderList(list, 'A', null)

    expect(ids(result)).toEqual(['B', 'C', 'D', 'A'])
  })

  it('moving the last item to the end is a no-op order-wise', () => {
    const list = makeList('A', 'B', 'C')

    const result = reorderList(list, 'C', null)

    expect(ids(result)).toEqual(['A', 'B', 'C'])
  })

  it('does not mutate the input list', () => {
    const list = makeList('A', 'B', 'C')

    reorderList(list, 'A', 'C', true)

    expect(ids(list)).toEqual(['A', 'B', 'C'])
  })
})

describe('isBelowMidpoint', () => {
  it('is false exactly at the midpoint', () => {
    expect(isBelowMidpoint(50, { top: 0, height: 100 })).toBe(false)
  })

  it('is false above the midpoint', () => {
    expect(isBelowMidpoint(20, { top: 0, height: 100 })).toBe(false)
  })

  it('is true below the midpoint', () => {
    expect(isBelowMidpoint(80, { top: 0, height: 100 })).toBe(true)
  })

  it('accounts for a non-zero rect top', () => {
    expect(isBelowMidpoint(160, { top: 100, height: 100 })).toBe(true)
    expect(isBelowMidpoint(140, { top: 100, height: 100 })).toBe(false)
  })
})
