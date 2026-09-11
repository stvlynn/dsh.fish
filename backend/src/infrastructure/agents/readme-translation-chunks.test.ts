import { describe, expect, it } from 'vitest'
import {
  preserveBoundaryNewlines,
  splitReadmeForTranslation,
} from './readme-translation-chunks.js'

describe('splitReadmeForTranslation', () => {
  it('preserves fenced code and excludes it from model work', () => {
    const markdown = [
      '# Title\n',
      'Paragraph.\n',
      '```ts\n',
      'const literal = "```not a closing fence"\n',
      '```\n',
      'Tail.\n',
    ].join('')
    const chunks = splitReadmeForTranslation(markdown)

    expect(chunks.map((chunk) => chunk.text).join('')).toBe(markdown)
    expect(chunks.filter((chunk) => !chunk.translate)).toHaveLength(1)
    expect(chunks.find((chunk) => !chunk.translate)?.text).toContain('not a closing fence')
  })

  it('bounds translatable chunks and preserves long input', () => {
    const markdown = `${'a'.repeat(9_000)}\n`
    const chunks = splitReadmeForTranslation(markdown)

    expect(chunks.map((chunk) => chunk.text).join('')).toBe(markdown)
    expect(
      Math.max(...chunks.filter((chunk) => chunk.translate).map((chunk) => chunk.text.length)),
    ).toBeLessThanOrEqual(4_000)
  })

  it('keeps chunk joins from collapsing Markdown blocks', () => {
    expect(preserveBoundaryNewlines('# Source\n\n', '# 译文')).toBe('# 译文\n\n')
    expect(preserveBoundaryNewlines('\nParagraph\n', '\n\n段落\n\n')).toBe('\n段落\n')
  })
})
