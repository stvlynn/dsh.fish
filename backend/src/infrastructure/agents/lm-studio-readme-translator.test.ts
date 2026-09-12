import { describe, expect, it, vi } from 'vitest'
import { translateWithLmStudio } from './lm-studio-readme-translator.js'

describe('translateWithLmStudio', () => {
  it('uses the VPC service and preserves the model contract', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const body = (await request.json()) as {
        model: string
        messages: readonly { content: string }[]
        temperature: number
        top_p: number
        top_k: number
        repetition_penalty: number
      }
      expect(request.url).toBe('http://localhost:1234/v1/chat/completions')
      expect(body.model).toBe('hy-mt2-1.8b')
      expect(body.messages[0]?.content).toBe(
        'Translate the following text into Chinese. Note that you should only output the translated result without any additional explanation:\n\n# Title',
      )
      expect(body).toMatchObject({
        temperature: 0.7,
        top_p: 0.6,
        top_k: 20,
        repetition_penalty: 1.05,
      })
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

  it('rejects output in the wrong target script', async () => {
    const service = {
      fetch: vi.fn(async () =>
        Response.json({
          choices: [{ message: { content: 'Still written in English.' } }],
        }),
      ),
    } as unknown as Fetcher

    await expect(
      translateWithLmStudio(service, 'Translate this sentence.', 'zh-CN', 'summary'),
    ).rejects.toThrow('target script')
  })

  it('rejects mutated technical literals', async () => {
    const service = {
      fetch: vi.fn(async () =>
        Response.json({
          choices: [
            {
              message: {
                content: 'Search the gh-pull-dsh-plugin topic with --force at https://example.com.',
              },
            },
          ],
        }),
      ),
    } as unknown as Fetcher

    await expect(
      translateWithLmStudio(
        service,
        'Search the dsh-plugin topic with --force at https://example.com.',
        'en',
        'summary',
      ),
    ).rejects.toThrow('protected literal')
  })

  it('allows natural-language hyphenated compounds to be translated', async () => {
    const service = {
      fetch: vi.fn(async () =>
        Response.json({ choices: [{ message: { content: 'A search interface driven by keys.' } }] }),
      ),
    } as unknown as Fetcher

    await expect(
      translateWithLmStudio(service, 'A keyboard-first search interface.', 'en', 'summary'),
    ).resolves.toBe('A search interface driven by keys.')
  })

  it('masks and restores protected literals without adding prompt instructions', async () => {
    const fetch = vi.fn(async (request: Request) => {
      const body = (await request.json()) as { messages: readonly { content: string }[] }
      expect(body.messages[0]?.content).toContain(
        '\n\nUse __I18N_0__ from __I18N_1__ at __I18N_2__.',
      )
      return Response.json({
        choices: [
          { message: { content: '请从 __I18N_1__ 使用 __I18N_0__，地址为 __I18N_2__。' } },
        ],
      })
    })

    await expect(
      translateWithLmStudio(
        { fetch } as unknown as Fetcher,
        'Use dsh-plugin from `@dsh-fish/hub` at https://dsh.fish.',
        'zh-CN',
        'summary',
      ),
    ).resolves.toBe('请从 `@dsh-fish/hub` 使用 dsh-plugin，地址为 https://dsh.fish。')
  })
})
