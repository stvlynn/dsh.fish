import { describe, expect, it } from 'vitest'
import {
  extractAwesomeDshPlugin,
  extractOhMyDsh,
  overlayFromCandidates,
} from './list-candidates.js'

describe('extractAwesomeDshPlugin', () => {
  it('reads url and category out of plugins[]', () => {
    expect(
      extractAwesomeDshPlugin({
        plugins: [
          { url: 'https://github.com/acme/hud', category: 'ui' },
          { url: 'https://github.com/acme/skip' },
        ],
      }),
    ).toEqual([
      { url: 'https://github.com/acme/hud', category: 'ui' },
      { url: 'https://github.com/acme/skip' },
    ])
  })

  it('keeps a curated npm name and Release tarball when the list recorded them', () => {
    expect(
      extractAwesomeDshPlugin({
        plugins: [
          {
            url: 'https://github.com/acme/hud',
            npm: 'dsh-hud',
            tarball: 'https://github.com/acme/hud/releases/download/v1.0.0/hud.tgz',
          },
          { url: 'https://github.com/acme/skip', npm: null },
        ],
      }),
    ).toEqual([
      {
        url: 'https://github.com/acme/hud',
        npm: 'dsh-hud',
        tarball: 'https://github.com/acme/hud/releases/download/v1.0.0/hud.tgz',
      },
      { url: 'https://github.com/acme/skip' },
    ])
  })
})

describe('extractOhMyDsh', () => {
  it('reads url and category out of items[]', () => {
    expect(
      extractOhMyDsh({
        items: [{ url: 'https://github.com/acme/pg-tools', category: 'agent' }],
      }),
    ).toEqual([{ url: 'https://github.com/acme/pg-tools', category: 'agent' }])
  })
})

describe('overlayFromCandidates', () => {
  it('keeps the first list\'s label and maps aliases onto canonical ids', () => {
    const overlay = overlayFromCandidates([
      [{ url: 'https://github.com/acme/hud', category: 'ui' }],
      [
        { url: 'https://github.com/acme/hud', category: 'webui' },
        { url: 'https://github.com/acme/memory', category: 'agent' },
      ],
    ])
    expect(overlay.get('acme/hud')).toBe('ui')
    expect(overlay.get('acme/memory')).toBe('tools')
  })

  it('drops a label the taxonomy does not have', () => {
    const overlay = overlayFromCandidates([
      [{ url: 'https://github.com/acme/x', category: 'not-a-category' }],
    ])
    expect(overlay.size).toBe(0)
  })
})
