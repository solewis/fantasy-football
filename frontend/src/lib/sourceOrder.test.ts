import { describe, expect, it } from 'vitest'

import { moveInOrder, reconcileOrder, sortByOrder } from './sourceOrder'

describe('reconcileOrder', () => {
  it('keeps known refs in their stored order', () => {
    expect(reconcileOrder(['b', 'a'], ['a', 'b'])).toEqual(['b', 'a'])
  })

  it('appends a newly available ref rather than discarding the stored order', () => {
    // A freshly imported dataset or a newly built rank set shouldn't silently
    // reset everyone else's priority -- it just joins at the back.
    expect(reconcileOrder(['b', 'a'], ['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('drops a ref that is no longer available', () => {
    expect(reconcileOrder(['a', 'b', 'c'], ['a', 'c'])).toEqual(['a', 'c'])
  })

  it('starts from the available list verbatim when nothing is stored', () => {
    expect(reconcileOrder([], ['a', 'b'])).toEqual(['a', 'b'])
  })
})

describe('moveInOrder', () => {
  it('swaps with the previous entry', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c'])
  })

  it('swaps with the next entry', () => {
    expect(moveInOrder(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b'])
  })

  it('is a no-op at the top', () => {
    expect(moveInOrder(['a', 'b'], 'a', 'up')).toEqual(['a', 'b'])
  })

  it('is a no-op at the bottom', () => {
    expect(moveInOrder(['a', 'b'], 'b', 'down')).toEqual(['a', 'b'])
  })

  it('is a no-op for a ref not in the order', () => {
    expect(moveInOrder(['a', 'b'], 'z', 'up')).toEqual(['a', 'b'])
  })
})

describe('sortByOrder', () => {
  it('orders items by their priority position', () => {
    const items = [{ ref: 'b' }, { ref: 'a' }, { ref: 'c' }]
    expect(
      sortByOrder(items, ['a', 'b', 'c'], (i) => i.ref).map((i) => i.ref),
    ).toEqual(['a', 'b', 'c'])
  })

  it('puts an unlisted item after everything that is listed', () => {
    const items = [{ ref: 'z' }, { ref: 'a' }]
    expect(sortByOrder(items, ['a'], (i) => i.ref).map((i) => i.ref)).toEqual([
      'a',
      'z',
    ])
  })
})
