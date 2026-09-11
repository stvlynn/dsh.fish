const CHAT_COMPLETIONS_URL = 'http://localhost:1234/v1/chat/completions'
const MODEL = 'hy-mt2-1.8b'

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
}

interface ChatCompletionResponse {
  readonly choices?: readonly {
    readonly message?: { readonly content?: string }
  }[]
  readonly usage?: {
    readonly prompt_tokens?: number
    readonly completion_tokens?: number
    readonly total_tokens?: number
  }
}

export async function translateWithLmStudio(
  service: Fetcher,
  text: string,
  locale: string,
  kind: 'readme' | 'summary',
): Promise<string> {
  const language = LANGUAGE_NAMES[locale]
  if (language === undefined) throw new Error(`Unsupported translation locale: ${locale}`)

  const response = await service.fetch(
    new Request(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: prompt(text, language, kind),
          },
        ],
        temperature: 0,
        max_tokens: 4_096,
        stream: false,
      }),
    }),
  )

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500)
    throw new Error(`LM Studio returned HTTP ${response.status}: ${detail}`)
  }

  const result = (await response.json()) as ChatCompletionResponse
  const translated = result.choices?.[0]?.message?.content
  if (translated === undefined || translated.trim() === '') {
    throw new Error('LM Studio returned an empty translation.')
  }

  console.info(
    JSON.stringify({
      event: 'readme_i18n_usage',
      provider: 'lm-studio',
      model: MODEL,
      kind,
      locale,
      promptTokens: result.usage?.prompt_tokens,
      completionTokens: result.usage?.completion_tokens,
      totalTokens: result.usage?.total_tokens,
    }),
  )
  return translated
}

function prompt(text: string, language: string, kind: 'readme' | 'summary'): string {
  const format =
    kind === 'readme'
      ? 'Preserve Markdown structure, links, code, commands, paths, identifiers, and placeholders exactly.'
      : 'Preserve code, commands, paths, identifiers, and placeholders exactly.'
  return [
    `Translate the following technical ${kind} into ${language}.`,
    format,
    'If text is already in the target language, keep it unchanged.',
    'Return only the translation, without explanations or wrappers.',
    '',
    text,
  ].join('\n')
}
