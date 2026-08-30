import { describe, expect, it } from 'vitest'
import { lookupNpmBinding } from './npm-binding.js'

describe('lookupNpmBinding', () => {
  it('returns the binding when the packument repository matches', async () => {
    const fetchImpl = async () =>
      Response.json({
        name: 'dsh-context',
        'dist-tags': { latest: '0.8.0' },
        versions: {
          '0.8.0': { repository: { url: 'https://github.com/bowenliang123/dsh-context.git' } },
        },
      })

    await expect(
      lookupNpmBinding('dsh-context', 'bowenliang123', 'dsh-context', fetchImpl),
    ).resolves.toEqual({ packageName: 'dsh-context', latestVersion: '0.8.0' })
  })

  it('returns nothing on 404 or a mismatched remote', async () => {
    await expect(
      lookupNpmBinding('missing', 'acme', 'missing', async () => new Response('Not Found', { status: 404 })),
    ).resolves.toBeUndefined()

    const squatted = async () =>
      Response.json({
        name: 'dsh-context',
        'dist-tags': { latest: '1.0.0' },
        versions: { '1.0.0': { repository: { url: 'https://github.com/evil/dsh-context.git' } } },
      })
    await expect(
      lookupNpmBinding('dsh-context', 'bowenliang123', 'dsh-context', squatted),
    ).resolves.toBeUndefined()
  })
})
