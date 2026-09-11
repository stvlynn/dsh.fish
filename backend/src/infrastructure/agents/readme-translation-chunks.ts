export interface ReadmeTranslationChunk {
  readonly index: number
  readonly text: string
  readonly translate: boolean
}

const TRANSLATABLE_CHUNK_SIZE = 4_000
const PROTECTED_CHUNK_SIZE = 32_000
const FENCE = /^ {0,3}(`{3,}|~{3,})/

/**
 * Splits Markdown on line boundaries while keeping fenced code out of the
 * model. Concatenating protected chunks is byte-for-byte lossless.
 */
export function splitReadmeForTranslation(markdown: string): readonly ReadmeTranslationChunk[] {
  const chunks: Array<Omit<ReadmeTranslationChunk, 'index'>> = []
  let buffer = ''
  let protectedBlock = false
  let fenceMarker: '`' | '~' | undefined
  let fenceLength = 0

  const flush = () => {
    if (buffer === '') return
    const size = protectedBlock ? PROTECTED_CHUNK_SIZE : TRANSLATABLE_CHUNK_SIZE
    for (let offset = 0; offset < buffer.length; offset += size) {
      chunks.push({
        text: buffer.slice(offset, offset + size),
        translate: !protectedBlock,
      })
    }
    buffer = ''
  }

  for (const line of markdown.match(/.*(?:\n|$)/g) ?? []) {
    if (line === '') continue
    const match = FENCE.exec(line)
    const fence = match?.[1]
    const marker = fence?.[0] as '`' | '~' | undefined

    const opensFence = !protectedBlock && marker !== undefined
    if (opensFence) {
      flush()
      protectedBlock = true
      fenceMarker = marker
      fenceLength = fence!.length
    }

    const limit = protectedBlock ? PROTECTED_CHUNK_SIZE : TRANSLATABLE_CHUNK_SIZE
    if (buffer !== '' && buffer.length + line.length > limit) flush()
    buffer += line

    const closesFence =
      protectedBlock &&
      !opensFence &&
      marker === fenceMarker &&
      fence !== undefined &&
      fence.length >= fenceLength &&
      line.slice(match![0].length).trim() === ''
    if (closesFence) {
      flush()
      protectedBlock = false
      fenceMarker = undefined
      fenceLength = 0
    }
  }
  flush()

  return chunks.map((chunk, index) => ({ index, ...chunk }))
}

export function preserveBoundaryNewlines(source: string, translated: string): string {
  const leading = source.match(/^\n+/)?.[0] ?? ''
  const trailing = source.match(/\n+$/)?.[0] ?? ''
  let result = translated
  if (leading !== '') result = leading + result.replace(/^\n+/, '')
  if (trailing !== '') result = result.replace(/\n+$/, '') + trailing
  return result
}
