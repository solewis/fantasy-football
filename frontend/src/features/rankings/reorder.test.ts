import { describe, expect, it } from 'vitest'

import { reorderList } from './reorder'

interface Item {
  platform_player_id: string
}

const ids = (list: Item[]) => list.map((item) => item.platform_player_id)

function makeList(...ids: string[]): Item[] {
  return ids.map((platform_player_id) => ({ platform_player_id }))
}

describe('reorderList', () => {
  it('moves an earlier item to just before a later target', () => {
    const list = makeList('A', 'B', 'C', 'D')

    const result = reorderList(list, 'A', 'C')

    expect(ids(result)).toEqual(['B', 'A', 'C', 'D'])
  })

  it('moves a later item to just before an earlier target', () => {
    const list = makeList('A', 'B', 'C', 'D')

    const result = reorderList(list, 'D', 'B')

    expect(ids(result)).toEqual(['A', 'D', 'B', 'C'])
  })

  it('dropping onto the item immediately after it is a no-op order-wise', () => {
    const list = makeList('A', 'B', 'C', 'D')

    const result = reorderList(list, 'A', 'B')

    expect(ids(result)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('is a true no-op (same reference) when dropped on itself', () => {
    const list = makeList('A', 'B', 'C')

    const result = reorderList(list, 'B', 'B')

    expect(result).toBe(list)
  })

  it('returns the original list unchanged for an unknown dragged id', () => {
    const list = makeList('A', 'B', 'C')

    const result = reorderList(list, 'ZZZ', 'B')

    expect(result).toBe(list)
  })

  it('returns the original list unchanged for an unknown target id', () => {
    const list = makeList('A', 'B', 'C')

    const result = reorderList(list, 'A', 'ZZZ')

    expect(result).toBe(list)
  })

  it('moves an item to the very end when target is null', () => {
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

    reorderList(list, 'A', 'C')

    expect(ids(list)).toEqual(['A', 'B', 'C'])
  })
})
