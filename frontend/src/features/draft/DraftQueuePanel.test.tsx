import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { QueueRow } from '../../api/draft'
import { DraftQueuePanel } from './DraftQueuePanel'

const queue: QueueRow[] = [
  { platform_player_id: '1', name: 'Josh Allen', position: 'QB', team: 'BUF' },
  {
    platform_player_id: '2',
    name: 'Bijan Robinson',
    position: 'RB',
    team: 'ATL',
  },
]

describe('DraftQueuePanel', () => {
  it('shows an empty message when the queue is empty', () => {
    render(
      <DraftQueuePanel
        queue={[]}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onDraft={vi.fn()}
      />,
    )

    expect(screen.getByText(/No players in your queue/)).toBeInTheDocument()
  })

  it('renders queued players in order', () => {
    render(
      <DraftQueuePanel
        queue={queue}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onDraft={vi.fn()}
      />,
    )

    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Josh Allen')
    expect(rows[1]).toHaveTextContent('Bijan Robinson')
  })

  it('move-down button reorders and calls onReorder', () => {
    const onReorder = vi.fn()
    render(
      <DraftQueuePanel
        queue={queue}
        onReorder={onReorder}
        onRemove={vi.fn()}
        onDraft={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Move Josh Allen down' }),
    )

    expect(onReorder).toHaveBeenCalledWith([queue[1], queue[0]])
  })

  it('disables move-up on the first row and move-down on the last row', () => {
    render(
      <DraftQueuePanel
        queue={queue}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onDraft={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('button', { name: 'Move Josh Allen up' }),
    ).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Move Bijan Robinson down' }),
    ).toBeDisabled()
  })

  it('draft button calls onDraft with the player id', () => {
    const onDraft = vi.fn()
    render(
      <DraftQueuePanel
        queue={queue}
        onReorder={vi.fn()}
        onRemove={vi.fn()}
        onDraft={onDraft}
      />,
    )

    fireEvent.click(screen.getAllByRole('button', { name: 'Draft' })[0])

    expect(onDraft).toHaveBeenCalledWith('1')
  })

  it('remove button calls onRemove with the player id', () => {
    const onRemove = vi.fn()
    render(
      <DraftQueuePanel
        queue={queue}
        onReorder={vi.fn()}
        onRemove={onRemove}
        onDraft={vi.fn()}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: 'Remove Bijan Robinson from queue' }),
    )

    expect(onRemove).toHaveBeenCalledWith('2')
  })
})
