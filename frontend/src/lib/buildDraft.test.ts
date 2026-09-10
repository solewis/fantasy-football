import { describe, expect, it } from 'vitest'

import { parseStoredBuildDraft, reconcileSelection } from './buildDraft'

describe('parseStoredBuildDraft', () => {
  it('returns null when nothing has been stored yet', () => {
    expect(parseStoredBuildDraft(null)).toBeNull()
  })

  it('parses a well-formed draft', () => {
    const raw = JSON.stringify({
      scope: 'QB',
      targetChoice: 9,
      newSetName: 'My QBs',
      order: ['p1', 'p2'],
      breaks: { p1: 'major' },
      flags: { p2: 'target' },
      dirty: true,
      selectedRefs: ['adp'],
      knownRefs: ['adp', 'dataset:1'],
    })

    const draft = parseStoredBuildDraft(raw)

    expect(draft?.order).toEqual(['p1', 'p2'])
    expect(draft?.targetChoice).toBe(9)
    expect(draft?.dirty).toBe(true)
  })

  it('tolerates corrupted JSON rather than throwing', () => {
    expect(parseStoredBuildDraft('{not json')).toBeNull()
  })

  it('rejects a shape whose order is not an array of strings', () => {
    expect(parseStoredBuildDraft(JSON.stringify({ order: 'nope' }))).toBeNull()
    expect(parseStoredBuildDraft(JSON.stringify({ order: [1, 2] }))).toBeNull()
    expect(parseStoredBuildDraft(JSON.stringify({}))).toBeNull()
  })
})

describe('reconcileSelection', () => {
  it('selects everything on a first-ever visit, when nothing was previously known', () => {
    // Matches the pre-persistence default: a freshly imported dataset (or the
    // very first load) shouldn't sit unchecked.
    const result = reconcileSelection([], [], ['adp', 'dataset:1'])

    expect(result.sort()).toEqual(['adp', 'dataset:1'])
  })

  it('keeps a deliberate uncheck across a remount', () => {
    // "WR only" was known before and deliberately left out of the persisted
    // selection -- it must not spring back to checked just because it still
    // exists.
    const result = reconcileSelection(
      ['adp'],
      ['adp', 'dataset:2'],
      ['adp', 'dataset:2'],
    )

    expect(result).toEqual(['adp'])
  })

  it('defaults a brand-new source to checked, without disturbing an existing deliberate uncheck', () => {
    const result = reconcileSelection(
      ['adp'],
      ['adp', 'dataset:2'],
      ['adp', 'dataset:2', 'dataset:3'],
    )

    expect(result.sort()).toEqual(['adp', 'dataset:3'])
  })

  it('drops a persisted ref that no longer exists', () => {
    const result = reconcileSelection(
      ['adp', 'dataset:1'],
      ['adp', 'dataset:1'],
      ['adp'],
    )

    expect(result).toEqual(['adp'])
  })
})
