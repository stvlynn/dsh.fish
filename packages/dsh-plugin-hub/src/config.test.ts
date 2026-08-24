import { describe, expect, it } from 'vitest'
import { Config, DEFAULT_CONFIG, parseConfig } from './config.js'

describe('Config schema', () => {
  it('exposes Standard Schema so Cordis 4 can validate without crashing', () => {
    const result = Config['~standard'].validate(undefined)
    expect(result.issues).toBeUndefined()
    expect(result.value).toEqual(DEFAULT_CONFIG)
  })

  it('fills omitted fields from the documented defaults', () => {
    expect(parseConfig({}).value).toEqual(DEFAULT_CONFIG)
    expect(parseConfig({ baseUrl: ' https://hub.example/ ' }).value).toEqual({
      baseUrl: 'https://hub.example/',
      targetProfile: 'current',
    })
  })

  it('rejects a non-string field rather than passing it through', () => {
    const result = parseConfig({ baseUrl: 1, targetProfile: 'web' })
    expect(result.value).toBeUndefined()
    expect(result.issues).toEqual([{ message: 'expected a string', path: ['baseUrl'] }])
  })
})
