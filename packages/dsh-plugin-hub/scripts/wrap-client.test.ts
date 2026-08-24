import { describe, expect, it } from 'vitest'
import { CLIENT_MODULE_ID, wrapClientCjs } from './wrap-client.mjs'

describe('wrapClientCjs', () => {
  it('registers the published package id with the DSH module loader', () => {
    const wrapped = wrapClientCjs(
      '"use strict";\nexports.apply = function apply() {};\nexports.inject = ["slots"];\n',
    )
    let registration: { id: string; factory: (require: unknown) => { apply?: unknown } } | undefined
    new Function(
      'window',
      wrapped,
    )({
      __ModuleLoader__: {
        load(value: typeof registration) {
          registration = value
        },
      },
    })
    expect(registration?.id).toBe(CLIENT_MODULE_ID)
    const exported = registration?.factory(() => ({}))
    expect(typeof exported?.apply).toBe('function')
  })

  it('refuses to wrap a leftover ESM bundle', () => {
    expect(() => wrapClientCjs('import { apply } from "./index.js";\n')).toThrow(/still ESM/)
  })
})
