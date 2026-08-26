import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DeltaChip } from './DeltaChip'

/** Note: never assert on computed colour here. jsdom doesn't resolve CSS
 * custom properties, so getComputedStyle(...).backgroundColor comes back empty
 * and the assertion would pass vacuously. data-bucket is the assertion
 * surface, which is exactly why it's an attribute. */
describe('DeltaChip', () => {
  it('prints the signed number, so colour is never the only channel', () => {
    render(
      <DeltaChip
        sourceRank={4}
        slot={1}
        sourceLabel="FantasyPros"
        slotLabel="WR1"
      />,
    )

    expect(screen.getByText('+3')).toBeInTheDocument()
  })

  it('marks agreement neutral and disagreement on an arm', () => {
    const { rerender, container } = render(
      <DeltaChip sourceRank={1} slot={1} sourceLabel="ADP" slotLabel="WR1" />,
    )
    expect(container.querySelector('.delta-chip')).toHaveAttribute(
      'data-bucket',
      'neutral',
    )

    rerender(
      <DeltaChip sourceRank={3} slot={1} sourceLabel="ADP" slotLabel="WR1" />,
    )
    expect(container.querySelector('.delta-chip')).toHaveAttribute(
      'data-arm',
      'behind',
    )

    rerender(
      <DeltaChip sourceRank={1} slot={4} sourceLabel="ADP" slotLabel="WR4" />,
    )
    expect(container.querySelector('.delta-chip')).toHaveAttribute(
      'data-arm',
      'value',
    )
  })

  it('renders an unranked player as a dash with a missing bucket', () => {
    const { container } = render(
      <DeltaChip
        sourceRank={null}
        slot={1}
        sourceLabel="ADP"
        slotLabel="WR1"
      />,
    )

    expect(screen.getByText('—')).toBeInTheDocument()
    expect(container.querySelector('.delta-chip')).toHaveAttribute(
      'data-bucket',
      'missing',
    )
  })

  it('names the source, its rank and the slot for a screen reader', () => {
    render(
      <DeltaChip
        sourceRank={5}
        slot={2}
        sourceLabel="FantasyPros"
        slotLabel="WR2"
      />,
    )

    expect(
      screen.getByText(/FantasyPros has them 3 lower, at 5/),
    ).toBeInTheDocument()
  })

  it('says "doesn\'t rank this deep" when the source simply stops short', () => {
    render(
      <DeltaChip
        sourceRank={null}
        slot={200}
        sourceLabel="FantasyPros"
        slotLabel="#200"
        beyondDepth
      />,
    )

    expect(screen.getByText(/doesn't rank this deep/)).toBeInTheDocument()
  })
})
