import { describe, expect, it, vi } from 'vitest'
import { translateWithLmStudio } from './lm-studio-readme-translator.js'

describe('translateWithLmStudio', () => {
  it('uses the VPC service and preserves the model contract', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const body = (await request.json()) as {
        model: string
        messages: readonly { content: string }[]
      }
      expect(request.url).toBe('http://localhost:1234/v1/chat/completions')
      expect(body.model).toBe('hy-mt2-1.8b')
      expect(body.messages[0]?.content).toContain('Simplified Chinese')
      expect(body.messages[0]?.content).toContain('Preserve Markdown')
      return Response.json({ choices: [{ message: { content: '译文' } }] })
    })

    await expect(
      translateWithLmStudio({ fetch } as unknown as Fetcher, '# Title', 'zh-CN', 'readme'),
    ).resolves.toBe('译文')
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('fails loudly for unsupported locales and upstream failures', async () => {
    const service = { fetch: vi.fn() } as unknown as Fetcher
    await expect(translateWithLmStudio(service, 'Text', 'de', 'summary')).rejects.toThrow(
      'Unsupported translation locale',
    )

    const failed = {
      fetch: vi.fn(async () => new Response('offline', { status: 503 })),
    } as unknown as Fetcher
    await expect(translateWithLmStudio(failed, 'Text', 'ja', 'summary')).rejects.toThrow('HTTP 503')
  })
})
