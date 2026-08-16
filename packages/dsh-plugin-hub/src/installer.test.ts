import { describe, expect, it } from 'vitest'
import { composePatchContents } from './installer.js'
import { absoluteUrl } from './hub-client.js'

describe('composePatchContents', () => {
  const row = ['- id: mcp-demo', "  name: '@deepseek-ai/dsh-mcp-client'"].join('\n')

  it('writes an insert list into an empty file', () => {
    const next = composePatchContents('', 'mcp-demo', row)
    expect(next).toContain('# dsh-hub:mcp-demo')
    expect(next).toContain('- insert:')
    expect(next).toContain('    - id: mcp-demo')
  })

  it('replaces a fresh profile\'s empty array instead of appending after it', () => {
    const next = composePatchContents('[]\n', 'mcp-demo', row)
    expect(next.startsWith('[]')).toBe(false)
    expect(next.trimStart().startsWith('# dsh-hub:mcp-demo')).toBe(true)
  })

  it('appends after an existing user layer', () => {
    const existing = ['- insert:', '    - id: already', '      name: other'].join('\n')
    const next = composePatchContents(existing, 'mcp-demo', row)
    expect(next).toContain('name: other')
    expect(next).toContain('# dsh-hub:mcp-demo')
  })
})

describe('absoluteUrl', () => {
  it('keeps an absolute verification URI', () => {
    expect(absoluteUrl('https://dsh.fish', 'https://dsh.fish/device')).toBe(
      'https://dsh.fish/device',
    )
  })

  it('resolves a relative verification URI against the hub origin', () => {
    expect(absoluteUrl('https://dsh.fish', '/device')).toBe('https://dsh.fish/device')
  })
})
