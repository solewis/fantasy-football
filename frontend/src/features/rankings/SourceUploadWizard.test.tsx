import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DatasetPreview } from '../../api/rankDatasets'
import { SourceUploadWizard } from './SourceUploadWizard'

function jsonResponse(body: unknown) {
  return { ok: true, json: () => Promise.resolve(body) }
}

const PREVIEW: DatasetPreview = {
  delimiter: ',',
  header_row_index: 0,
  columns: ['RK', 'PLAYER NAME', 'TEAM', 'POS', 'TIERS'],
  mapping: {
    name: 1,
    position: 3,
    team: 2,
    overall_rank: 0,
    position_rank: null,
    tier: 4,
    overall_rank_from_row_order: false,
    single_position: null,
  },
  confidence: 'high',
  row_count: 2,
  sample_rows: [
    {
      row_index: 0,
      source_name_raw: "Ja'Marr Chase",
      normalized_name: 'jamarr chase',
      position: 'WR',
      team: 'CIN',
      overall_rank: 1,
      position_rank: 1,
      position_rank_derived: false,
      tier: 1,
    },
  ],
  detected: { has_overall: true, has_positional: true, has_tier: true },
  warnings: [],
}

function mockBackend(preview: DatasetPreview = PREVIEW) {
  const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
    const { pathname } = new URL(url)
    if (pathname === '/rank-datasets/preview')
      return Promise.resolve(jsonResponse(preview))
    if (pathname === '/rank-datasets')
      return Promise.resolve(jsonResponse({ id: 1, name: 'FP' }))
    return Promise.resolve(jsonResponse([]))
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** The browser only reads the bytes -- parsing is server-side, so there's no
 * CSV parsing to fight jsdom over here. */
function selectFile(contents = 'RK,PLAYER NAME\n1,X\n') {
  const file = new File([contents], 'ranks.csv', { type: 'text/csv' })
  const input = screen.getByLabelText('Rankings file')
  fireEvent.change(input, { target: { files: [file] } })
  return file
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('SourceUploadWizard', () => {
  it('previews the file and prefills the name from the filename', async () => {
    mockBackend()
    render(
      <SourceUploadWizard
        format="half_ppr"
        onCancel={vi.fn()}
        onImported={vi.fn()}
      />,
    )

    selectFile()

    expect(await screen.findByText("Ja'Marr Chase")).toBeInTheDocument()
    expect(
      (screen.getByLabelText('Dataset name') as HTMLInputElement).value,
    ).toBe('ranks')
  })

  it('imports with the confirmed mapping', async () => {
    const fetchMock = mockBackend()
    const onImported = vi.fn()
    render(
      <SourceUploadWizard
        format="half_ppr"
        onCancel={vi.fn()}
        onImported={onImported}
      />,
    )
    selectFile()
    await screen.findByText("Ja'Marr Chase")

    fireEvent.click(screen.getByRole('button', { name: /Import 2 rows/ }))

    await waitFor(() => {
      expect(onImported).toHaveBeenCalled()
    })
    const post = fetchMock.mock.calls.find(
      ([url, init]) =>
        (url as string).endsWith('/rank-datasets') &&
        (init as RequestInit)?.method === 'POST',
    )
    if (!post) throw new Error('no /rank-datasets POST was made')
    const body = JSON.parse((post[1] as RequestInit).body as string) as Record<
      string,
      unknown
    >
    expect(body.name).toBe('ranks')
    expect(body.format).toBe('half_ppr')
    expect(body.mapping).toMatchObject({ name: 1, overall_rank: 0 })
  })

  it('re-previews through the mapping when a column is reassigned', async () => {
    const fetchMock = mockBackend()
    render(
      <SourceUploadWizard
        format="half_ppr"
        onCancel={vi.fn()}
        onImported={vi.fn()}
      />,
    )
    selectFile()
    await screen.findByText("Ja'Marr Chase")

    fireEvent.change(screen.getByLabelText('Column 5: TIERS'), {
      target: { value: 'ignore' },
    })

    await waitFor(() => {
      const previews = fetchMock.mock.calls.filter(([url]) =>
        (url as string).endsWith('/rank-datasets/preview'),
      )
      expect(previews.length).toBeGreaterThan(1)
    })
  })

  it('warns and blocks import when no column looks like a name', async () => {
    mockBackend({
      ...PREVIEW,
      confidence: 'low',
      mapping: { ...PREVIEW.mapping, name: null },
      warnings: ['No player-name column was recognized -- pick one below'],
    })
    render(
      <SourceUploadWizard
        format="half_ppr"
        onCancel={vi.fn()}
        onImported={vi.fn()}
      />,
    )

    selectFile()

    expect(
      await screen.findByText(/couldn't confidently read/i),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Import/ })).toBeDisabled()
  })

  it('requires a position when the file has positional ranks but no position column', async () => {
    mockBackend({
      ...PREVIEW,
      mapping: {
        ...PREVIEW.mapping,
        position: null,
        position_rank: 0,
        overall_rank: null,
      },
    })
    render(
      <SourceUploadWizard
        format="half_ppr"
        onCancel={vi.fn()}
        onImported={vi.fn()}
      />,
    )
    selectFile()
    await screen.findByLabelText('Single position')

    expect(screen.getByRole('button', { name: /Import/ })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Single position'), {
      target: { value: 'WR' },
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Import/ })).toBeEnabled()
    })
  })
})
