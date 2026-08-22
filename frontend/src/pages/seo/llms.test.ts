import { describe, expect, it } from 'vitest'
import { ARTIFACT_KINDS, CATEGORIES } from '@/entities/artifact/model/types'
import { docsLlmsFull, docsLlmsTxt, rootLlmsTxt } from './llms'

const ORIGIN = 'https://dsh.fish'

const FILE_ITEM = /^- \[[^\]]+\]\((https?:\/\/[^)]+|\/[^)]+)\)(?:: .+)?$/

describe('rootLlmsTxt', () => {
  const body = rootLlmsTxt(ORIGIN)
  const lines = body.split('\n')

  it('follows the v2 section order: H1, blockquote, notes, then H2 file lists', () => {
    expect(lines[0]).toBe('# dsh.fish')
    expect(lines[1]?.startsWith('> ')).toBe(true)
    const firstH2 = lines.findIndex((line) => line.startsWith('## '))
    expect(firstH2).toBeGreaterThan(2)
    expect(lines.slice(2, firstH2).some((line) => line.startsWith('#'))).toBe(false)
    expect(body).toContain('## Start here')
    expect(body).toContain('## Catalog')
    expect(body).toContain('## API')
    expect(body).toContain('## Optional')
  })

  it('uses the spec file-list shape and absolute URLs', () => {
    const items = lines.filter((line) => line.startsWith('- ['))
    expect(items.length).toBeGreaterThan(10)
    for (const line of items) {
      expect(line, line).toMatch(FILE_ITEM)
    }
  })

  it('lists every kind from the taxonomy as a markdown alias', () => {
    for (const kind of ARTIFACT_KINDS) {
      expect(body).toContain(`${ORIGIN}/kind/${kind}.md`)
    }
  })

  it('lists every category under Optional, generated from the taxonomy', () => {
    for (const category of CATEGORIES) {
      expect(body).toContain(`${ORIGIN}/category/${category.id}.md`)
    }
  })

  it('points at the docs index and the JSON catalog rather than enumerating plugins', () => {
    expect(body).toContain(`${ORIGIN}/docs/llms.txt`)
    expect(body).toContain(`${ORIGIN}/api/v1/catalog/snapshot`)
    expect(body).toContain(`${ORIGIN}/openapi.json`)
    expect(body).not.toMatch(/\/a\/[a-z0-9]+/)
  })
})

describe('docsLlmsTxt', () => {
  const body = docsLlmsTxt(ORIGIN, [
    { type: 'page', title: 'Docs', url: '/docs' },
    { type: 'separator', title: 'Start' },
    { type: 'page', title: 'Quickstart', url: '/docs/quickstart' },
    { type: 'separator', title: 'Reference' },
    { type: 'page', title: 'REST API', url: '/docs/api' },
  ])

  it('groups file lists under the nav separators and uses .md aliases', () => {
    expect(body.startsWith('# dsh.fish documentation')).toBe(true)
    expect(body).toContain('## Docs')
    expect(body).toContain(`[Docs](${ORIGIN}/docs/index.md)`)
    expect(body).toContain('## Start')
    expect(body).toContain(`[Quickstart](${ORIGIN}/docs/quickstart.md)`)
    expect(body).toContain('## Reference')
    expect(body).toContain(`[REST API](${ORIGIN}/docs/api.md)`)
  })
})

describe('docsLlmsFull', () => {
  it('concatenates every supplied English guide', () => {
    const body = docsLlmsFull([
      { path: '/docs/cli', markdown: '# CLI\n\nnpx @dsh-fish/cli' },
      { path: '/docs/api', markdown: '# API\n\nGET /api/v1/artifacts' },
    ])
    expect(body).toContain('# dsh.fish documentation')
    expect(body).toContain('# CLI')
    expect(body).toContain('# API')
    expect(body).toContain('npx @dsh-fish/cli')
  })
})
