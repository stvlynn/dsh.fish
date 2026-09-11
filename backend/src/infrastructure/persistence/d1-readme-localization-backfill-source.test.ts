import { describe, expect, it, vi } from 'vitest'
import { D1ReadmeLocalizationBackfillSource } from './d1-readme-localization-backfill-source.js'

describe('D1ReadmeLocalizationBackfillSource.listStaleFailures', () => {
  it('aggregates narrow retry candidates and orders the oldest first', async () => {
    const all = vi.fn(async () => ({
      results: [
        { artifact_id: 'alpha', markdown: '# Alpha', summary: 'Alpha summary.' },
        { artifact_id: 'beta', markdown: '   ', summary: 'Beta summary.' },
      ],
    }))
    const bind = vi.fn(() => ({ all }))
    const prepare = vi.fn((query: string) => {
      expect(query).toContain('with failed_candidates as')
      expect(query).toContain('group by artifact_id')
      expect(query).toContain('locale in (select value from json_each(?3))')
      expect(query).toContain('summary.locale = required_locale.value')
      expect(query).toContain('order by candidates.oldest_failure, artifact.id')
      return { bind }
    })
    const source = new D1ReadmeLocalizationBackfillSource(
      {
        $client: { prepare },
      } as never,
      ['en', 'zh-CN'],
    )
    const olderThan = new Date('2026-01-01T00:00:00.000Z')

    await expect(source.listStaleFailures(olderThan, 100)).resolves.toEqual([
      { artifactId: 'alpha', markdown: '# Alpha', summary: 'Alpha summary.' },
      { artifactId: 'beta', summary: 'Beta summary.' },
    ])
    expect(bind).toHaveBeenCalledWith(olderThan.getTime(), 100, '["en","zh-CN"]')
    expect(all).toHaveBeenCalledOnce()
  })
})
