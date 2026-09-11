import { describe, expect, it } from 'vitest'
import { readmeI18nShardName } from './readme-i18n-shards.js'

describe('readmeI18nShardName', () => {
  it('is deterministic and stays within four model queues', () => {
    const names = Array.from({ length: 100 }, (_, index) =>
      readmeI18nShardName(`artifact-${index}`),
    )
    expect(readmeI18nShardName('artifact-42')).toBe(readmeI18nShardName('artifact-42'))
    expect(new Set(names)).toEqual(
      new Set(['lm-studio-0', 'lm-studio-1', 'lm-studio-2', 'lm-studio-3']),
    )
  })
})
