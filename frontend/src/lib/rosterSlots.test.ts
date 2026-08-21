import { describe, expect, it } from 'vitest'

import { slotsFromRosterPositions } from './rosterSlots'

describe('slotsFromRosterPositions', () => {
  it('excludes bench slots', () => {
    const slots = slotsFromRosterPositions(['QB', 'RB', 'BN', 'BN'])

    expect(slots.map((s) => s.label)).toEqual(['QB', 'RB'])
  })

  it('maps single-position codes to themselves', () => {
    const slots = slotsFromRosterPositions(['QB', 'RB', 'WR', 'TE', 'K', 'DEF'])

    expect(slots).toEqual([
      { label: 'QB', eligible: ['QB'] },
      { label: 'RB', eligible: ['RB'] },
      { label: 'WR', eligible: ['WR'] },
      { label: 'TE', eligible: ['TE'] },
      { label: 'K', eligible: ['K'] },
      { label: 'DEF', eligible: ['DEF'] },
    ])
  })

  it('maps FLEX to RB/WR/TE eligibility', () => {
    const [slot] = slotsFromRosterPositions(['FLEX'])

    expect(slot.eligible).toEqual(['RB', 'WR', 'TE'])
  })

  it('maps SUPER_FLEX to QB/RB/WR/TE eligibility', () => {
    const [slot] = slotsFromRosterPositions(['SUPER_FLEX'])

    expect(slot.eligible).toEqual(['QB', 'RB', 'WR', 'TE'])
  })

  it('maps WRRB_FLEX to RB/WR eligibility', () => {
    const [slot] = slotsFromRosterPositions(['WRRB_FLEX'])

    expect(slot.eligible).toEqual(['RB', 'WR'])
  })

  it('maps REC_FLEX to WR/TE eligibility', () => {
    const [slot] = slotsFromRosterPositions(['REC_FLEX'])

    expect(slot.eligible).toEqual(['WR', 'TE'])
  })

  it('falls back to a self-eligible slot for an unknown code', () => {
    const [slot] = slotsFromRosterPositions(['IDP_FLEX'])

    expect(slot).toEqual({ label: 'IDP_FLEX', eligible: ['IDP_FLEX'] })
  })

  it('preserves the order and repeat count from roster_positions', () => {
    const slots = slotsFromRosterPositions([
      'QB',
      'RB',
      'RB',
      'WR',
      'WR',
      'TE',
      'FLEX',
      'K',
      'DEF',
      'BN',
      'BN',
    ])

    expect(slots.map((s) => s.label)).toEqual([
      'QB',
      'RB',
      'RB',
      'WR',
      'WR',
      'TE',
      'FLEX',
      'K',
      'DEF',
    ])
  })
})
