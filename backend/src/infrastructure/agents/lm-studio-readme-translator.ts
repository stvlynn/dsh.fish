const CHAT_COMPLETIONS_URL = 'http://localhost:1234/v1/chat/completions'
const MODEL = 'hy-mt2-1.8b'

const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English',
  'zh-CN': 'Chinese',
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
  const protectedSource = protectLiterals(text)

  const response = await service.fetch(
    new Request(CHAT_COMPLETIONS_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'user',
            content: prompt(protectedSource.text, language),
          },
        ],
        temperature: 0.7,
        top_p: 0.6,
        top_k: 20,
        repetition_penalty: 1.05,
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
  const modelOutput = result.choices?.[0]?.message?.content
  if (modelOutput === undefined || modelOutput.trim() === '') {
    throw new Error('LM Studio returned an empty translation.')
  }
  const translated = restoreLiterals(modelOutput, protectedSource.literals)
  validateTranslation(text, translated, locale)

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

function prompt(text: string, language: string): string {
  return `Translate the following text into ${language}. Note that you should only output the translated result without any additional explanation:\n\n${text}`
}

const TARGET_SCRIPT: Readonly<Record<string, RegExp>> = {
  en: /\p{Script=Latin}/u,
  'zh-CN': /\p{Script=Han}/u,
  'zh-TW': /\p{Script=Han}/u,
  ja: /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u,
  ko: /\p{Script=Hangul}/u,
  ru: /\p{Script=Cyrillic}/u,
}

const PROTECTED_LITERAL =
  /`[^`\n]+`|https?:\/\/[^\s)>\],;!?]*[A-Za-z0-9/#]|--[A-Za-z0-9][\w-]*|@[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+|\b(?:dsh|mcp|npm|pnpm|yarn|bun|node|github|gitlab)-[A-Za-z0-9_-]+\b|\bDeepSeek Harness\b|\bdsh\b/giu

const placeholder = (index: number) => `__I18N_${index}__`

function protectLiterals(source: string): { readonly text: string; readonly literals: readonly string[] } {
  const literals: string[] = []
  const text = source.replace(PROTECTED_LITERAL, (literal) => {
    const token = placeholder(literals.length)
    literals.push(literal)
    return token
  })
  return { text, literals }
}

function restoreLiterals(translated: string, literals: readonly string[]): string {
  let restored = translated
  for (const [index, literal] of literals.entries()) {
    const token = placeholder(index)
    const first = restored.indexOf(token)
    if (first === -1 || restored.indexOf(token, first + token.length) !== -1) {
      throw new Error(`LM Studio changed a protected literal: ${literal.slice(0, 120)}`)
    }
    restored = restored.replace(token, literal)
  }
  return restored
}

function validateTranslation(source: string, translated: string, locale: string): void {
  const sourceLetters = source.match(/\p{L}/gu)?.length ?? 0
  const expectedScript = TARGET_SCRIPT[locale]
  if (sourceLetters >= 4 && expectedScript !== undefined && !expectedScript.test(translated)) {
    throw new Error(`LM Studio output does not contain the target script for ${locale}.`)
  }
}
