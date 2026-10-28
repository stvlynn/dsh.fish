import { describe, expect, it } from 'vitest'
import { admissionClass, admissionDecision } from './admission-class'

function request(path: string, headers: Record<string, string> = {}): Request {
  return new Request(`https://dsh.fish${path}`, { headers })
}

/** Headers Chromium sends, captured from a real browser. */
const NAVIGATE = { 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' }
const FETCH = { 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }

describe('admissionDecision', () => {
  it('lets cheap routes bypass admission', () => {
    expect(admissionDecision(request('/'))).toEqual({ kind: 'bypass' })
    expect(admissionDecision(request('/browse'))).toEqual({ kind: 'bypass' })
    expect(admissionDecision(request('/a/example?q=x'))).toEqual({ kind: 'bypass' })
  })

  it('lets an over-bound union bypass, because the handler refuses it without a query', () => {
    // Waiting for a slot would only take one from a request that will query.
    const path = '/browse?category=ui&category=usage&category=theme&category=model'
    expect(admissionDecision(request(path, NAVIGATE))).toEqual({ kind: 'bypass' })
    expect(
      admissionDecision(request('/api/v1/artifacts?kind=bundle&kind=skill&kind=profile')),
    ).toEqual({ kind: 'bypass' })
  })

  it('admits a costly query within bounds under its class', () => {
    expect(admissionDecision(request('/browse?q=git', NAVIGATE))).toEqual({
      kind: 'admit',
      class: 'document',
    })
    expect(admissionDecision(request('/browse.data?q=git', FETCH))).toEqual({
      kind: 'admit',
      class: 'interactive',
    })
  })
})

describe('admissionClass', () => {
  it('puts a top-level page load in the document class', () => {
    expect(admissionClass(request('/browse?q=git', NAVIGATE))).toBe('document')
  })

  it('puts a loaded page asking for data in the interactive class', () => {
    // React Router client navigation and the search palette.
    expect(admissionClass(request('/browse.data?q=git', FETCH))).toBe('interactive')
    expect(admissionClass(request('/api/v1/artifacts?q=git', FETCH))).toBe('interactive')
    expect(admissionClass(request('/api/v1/artifacts?q=git', { 'sec-fetch-mode': 'same-origin' }))).toBe(
      'interactive',
    )
  })

  it('treats a credentialed request as interactive whatever it fetches', () => {
    expect(admissionClass(request('/browse?q=git', { ...NAVIGATE, cookie: 'session=1' }))).toBe('interactive')
    expect(admissionClass(request('/browse?q=git', { authorization: 'Bearer t' }))).toBe('interactive')
  })

  it('classifies a client without fetch metadata by what it asks for', () => {
    // The plugin and the CLI call the API from Node and send no fetch metadata.
    expect(admissionClass(request('/api/v1/artifacts?q=git'))).toBe('interactive')
    // The same client asking for a whole page is a page load.
    expect(admissionClass(request('/browse?q=git'))).toBe('document')
  })

  it('places the measured scraper traffic entirely in the document class', () => {
    // Every captured request: navigate/document, no cookie, real Chrome UA.
    for (const site of ['none', 'same-origin', 'cross-site']) {
      expect(
        admissionClass(
          request('/ko/browse?category=docs&kind=skill', {
            ...NAVIGATE,
            'sec-fetch-site': site,
            referer: 'https://dsh.fish/',
          }),
        ),
      ).toBe('document')
    }
  })
})
