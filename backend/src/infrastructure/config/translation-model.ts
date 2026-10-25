/** Explicit production provider; changes require a new translation-policy revision. */
export const OPENCODE_GO_TRANSLATION = {
  url: 'https://opencode.ai/inference/go/openai/v1/chat/completions',
  model: 'beam-free',
  provider: 'opencode-go',
  userAgent: 'dsh-fish-localization/1.0',
} as const
