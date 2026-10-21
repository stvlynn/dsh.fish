import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openPersistence } from './open-persistence.js'

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  createPool: vi.fn(),
}))
vi.mock('mysql2/promise', () => ({ createPool: mocks.createPool }))
const hyperdrive = {
  host: 'database.internal',
  port: 3306,
  user: 'app',
  password: 'fixture-only',
  database: 'isolated',
}

describe('request-scoped persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.query.mockResolvedValue([[{ ok: 1 }], []])
    mocks.end.mockResolvedValue(undefined)
    mocks.createPool.mockReturnValue({ query: mocks.query, end: mocks.end })
  })
  it('fails closed when a MySQL binding is missing', async () => {
    await expect(openPersistence({ STORAGE_BACKEND: 'mysql' } as never)).rejects.toThrow(
      'requires HYPERDRIVE',
    )
    expect(mocks.createPool).not.toHaveBeenCalled()
  })
  it('rejects unknown backends rather than silently using D1', async () => {
    await expect(openPersistence({ STORAGE_BACKEND: 'other' } as never)).rejects.toThrow(
      'Unknown STORAGE_BACKEND',
    )
    expect(mocks.createPool).not.toHaveBeenCalled()
  })
  it('leases a bounded invocation pool without accessing D1', async () => {
    const env = {
      STORAGE_BACKEND: 'mysql',
      HYPERDRIVE: hyperdrive,
      get DB() {
        throw new Error('MySQL must not access D1')
      },
    }
    const persistence = await openPersistence(env as never)
    expect(mocks.createPool).toHaveBeenCalledWith(
      expect.objectContaining({ connectionLimit: 2, disableEval: true, queueLimit: 16 }),
    )
    expect(mocks.query).not.toHaveBeenCalled()
    expect(persistence.mysqlDb).toBeDefined()
    await persistence.dispose()
    expect(mocks.end).toHaveBeenCalledOnce()
  })
  it('does not hide a failure from the first real database operation', async () => {
    const persistence = await openPersistence({ STORAGE_BACKEND: 'mysql', HYPERDRIVE: hyperdrive } as never)
    mocks.query.mockRejectedValueOnce(new Error('origin unavailable'))
    await expect(persistence.artifacts.readFacetCounts()).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'origin unavailable' }) })
    await persistence.dispose()
    expect(mocks.end).toHaveBeenCalledOnce()
  })
})
