import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_CONFIG } from './config.js'

describe('Config schema', () => {
  it('implements Standard Schema so Cordis can validate the row', () => {
    expect(Config['~standard']?.version).toBe(1)
    expect(typeof Config['~standard']?.validate).toBe('function')
  })

  it('fills defaults when the row omits config', () => {
    expect(Config['~standard'].validate(undefined)).toEqual({ value: DEFAULT_CONFIG })
    expect(Config['~standard'].validate({})).toEqual({ value: DEFAULT_CONFIG })
  })

  it('accepts a self-hosted origin and a named profile', () => {
    expect(
      Config['~standard'].validate({
        baseUrl: 'https://hub.example/',
        targetProfile: 'headless',
      }),
    ).toEqual({
      value: { baseUrl: 'https://hub.example', targetProfile: 'headless' },
    })
  })

  it('rejects a non-object row', () => {
    const result = Config['~standard'].validate('https://dsh.fish')
    expect('issues' in result).toBe(true)
  })
})
