import { describe, expect, it } from 'vitest'
import { npmBindingFromPackument } from './npm-binding.js'

const packument = {
  name: 'dsh-context',
  'dist-tags': { latest: '0.8.0' },
  versions: {
    '0.8.0': {
      repository: { url: 'git+https://github.com/bowenliang123/dsh-context.git' },
    },
  },
}

describe('npmBindingFromPackument', () => {
  it('binds a packument whose repository is this owner/repo', () => {
    expect(npmBindingFromPackument(packument, 'bowenliang123', 'dsh-context')).toEqual({
      packageName: 'dsh-context',
      latestVersion: '0.8.0',
    })
  })

  it('ignores a packument that points at a different repository', () => {
    expect(npmBindingFromPackument(packument, 'evil', 'dsh-context')).toBeUndefined()
  })

  it('ignores a packument with no repository field', () => {
    expect(
      npmBindingFromPackument(
        { name: 'dsh-context', 'dist-tags': { latest: '0.8.0' }, versions: { '0.8.0': {} } },
        'bowenliang123',
        'dsh-context',
      ),
    ).toBeUndefined()
  })

  it('reads repository off the packument root when the version omits it', () => {
    expect(
      npmBindingFromPackument(
        {
          name: 'thing',
          repository: 'github:acme/thing',
          'dist-tags': { latest: '1.0.0' },
          versions: { '1.0.0': {} },
        },
        'acme',
        'thing',
      ),
    ).toEqual({ packageName: 'thing', latestVersion: '1.0.0' })
  })
})
