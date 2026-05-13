import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @tauri-apps/plugin-sql to capture SQL calls without a real SQLite.
const executeMock = vi.fn()
const selectMock = vi.fn()
vi.mock('@tauri-apps/plugin-sql', () => ({
  default: {
    load: vi.fn().mockResolvedValue({
      execute: executeMock,
      select: selectMock,
    }),
  },
}))

describe('downloads db helpers', () => {
  beforeEach(() => {
    executeMock.mockReset()
    selectMock.mockReset()
  })

  it('initDownloadsDb creates table + indexes', async () => {
    const { initDownloadsDb } = await import('./downloads')
    executeMock.mockResolvedValue(undefined)

    await initDownloadsDb()

    expect(executeMock).toHaveBeenCalledTimes(3)
    const sqls = executeMock.mock.calls.map((c) => c[0] as string)
    expect(sqls[0]).toMatch(/create table if not exists downloads/i)
    expect(sqls[1]).toMatch(/idx_downloads_started/i)
    expect(sqls[2]).toMatch(/idx_downloads_status/i)
  })

  it('insertDownloadStarted writes a started row and returns id', async () => {
    const { insertDownloadStarted } = await import('./downloads')
    executeMock.mockResolvedValue({ lastInsertId: 42, rowsAffected: 1 })

    const id = await insertDownloadStarted(
      'https://example.com/file.pdf',
      'file.pdf',
      '/Users/me/Downloads/file.pdf',
    )

    expect(id).toBe(42)
    const [sql, params] = executeMock.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/insert into downloads/i)
    expect(params[0]).toBe('https://example.com/file.pdf')
    expect(params[1]).toBe('file.pdf')
    expect(params[3]).toBe('started')
  })

  it('markDownloadFinished sets status=finished when success', async () => {
    const { markDownloadFinished } = await import('./downloads')
    executeMock.mockResolvedValue({ rowsAffected: 1 })

    await markDownloadFinished('https://example.com/file.pdf', '/tmp/file.pdf', true)

    const [sql, params] = executeMock.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/update downloads/i)
    expect(params[0]).toBe('finished')
    expect(params[2]).toBe('/tmp/file.pdf')
    expect(params[3]).toBe('https://example.com/file.pdf')
  })

  it('markDownloadFinished sets status=failed when !success', async () => {
    const { markDownloadFinished } = await import('./downloads')
    executeMock.mockResolvedValue({ rowsAffected: 1 })

    await markDownloadFinished('https://example.com/oops.zip', null, false)

    const [, params] = executeMock.mock.calls[0] as [string, unknown[]]
    expect(params[0]).toBe('failed')
    expect(params[2]).toBeNull()
  })

  it('getDownloads returns rows ordered desc with limit', async () => {
    const { getDownloads } = await import('./downloads')
    selectMock.mockResolvedValue([{ id: 1, url: 'x' }, { id: 2, url: 'y' }])

    const rows = await getDownloads(50)

    expect(rows).toHaveLength(2)
    const [sql, params] = selectMock.mock.calls[0] as [string, unknown[]]
    expect(sql).toMatch(/order by startedAt desc/i)
    expect(params[0]).toBe(50)
  })

  it('getInProgressDownloadCount returns count', async () => {
    const { getInProgressDownloadCount } = await import('./downloads')
    selectMock.mockResolvedValue([{ count: 3 }])

    const n = await getInProgressDownloadCount()

    expect(n).toBe(3)
    const [sql] = selectMock.mock.calls[0] as [string]
    expect(sql).toMatch(/where status = 'started'/i)
  })
})
