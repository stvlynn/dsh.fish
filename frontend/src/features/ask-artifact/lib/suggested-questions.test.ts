import { describe, expect, it } from 'vitest'
import {
  pickSuggestedQuestions,
  SUGGESTED_QUESTION_COUNT,
  SUGGESTED_QUESTION_KEYS,
} from './suggested-questions'

describe('pickSuggestedQuestions', () => {
  it('draws the requested number of distinct questions from the pool', () => {
    const picked = pickSuggestedQuestions('artifact-1')
    expect(picked).toHaveLength(SUGGESTED_QUESTION_COUNT)
    expect(new Set(picked).size).toBe(SUGGESTED_QUESTION_COUNT)
    for (const key of picked) expect(SUGGESTED_QUESTION_KEYS).toContain(key)
  })

  it('is stable for a seed, so the server and the client agree', () => {
    expect(pickSuggestedQuestions('artifact-1')).toEqual(pickSuggestedQuestions('artifact-1'))
  })

  it('gives neighbouring seeds different questions', () => {
    const a = pickSuggestedQuestions('artifact-1:0')
    const b = pickSuggestedQuestions('artifact-1:1')
    expect(a).not.toEqual(b)
  })

  it('redraws the kitchen-sink plugin used in e2e', () => {
    expect(pickSuggestedQuestions('dsh-postgres-mcp:0')).not.toEqual(
      pickSuggestedQuestions('dsh-postgres-mcp:1'),
    )
  })

  it('reaches every question in the pool across enough seeds', () => {
    const seen = new Set<string>()
    for (let round = 0; round < 200; round += 1) {
      for (const key of pickSuggestedQuestions(`seed:${round}`)) seen.add(key)
    }
    expect(seen.size).toBe(SUGGESTED_QUESTION_KEYS.length)
  })

  it('never returns more than the pool holds', () => {
    const picked = pickSuggestedQuestions('artifact-1', SUGGESTED_QUESTION_KEYS.length + 5)
    expect(picked).toHaveLength(SUGGESTED_QUESTION_KEYS.length)
  })
})
