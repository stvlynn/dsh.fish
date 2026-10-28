/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarketPage } from './MarketPage.js'
import { dictionaries, type HubLocaleKey } from './locale.js'

/** Renders English copy, and fails loudly on a key with no translation. */
function translate(key: HubLocaleKey, vars?: Record<string, string | number>): string {
  const template = dictionaries.en[key]
  if (template === undefined) throw new Error(`missing key: ${key}`)
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => String(vars?.[name] ?? ''))
}

interface Route {
  status?: number
  body: unknown
}

function stubFetch(routes: Record<string, Route | (() => Route)>): void {
  vi.stubGlobal('fetch', async (input: string, init?: RequestInit) => {
    const path = input.replace('/api/dsh-fish', '')
    const key = `${init?.method ?? 'GET'} ${path}`
    const match = routes[key] ?? routes[`${init?.method ?? 'GET'} ${path.split('?')[0]}`]
    if (match === undefined) throw new Error(`unstubbed request: ${key}`)
    const route = typeof match === 'function' ? match() : match
    const status = route.status ?? 200
    return {
      ok: status < 400,
      status,
      json: async () => route.body,
    } as Response
  })
}

const STATE = {
  profile: 'local-dsh',
  version: '0.4.2',
  baseUrl: 'https://dsh.fish',
  account: { signedIn: false },
  installed: [],
}

const CATALOG = {
  total: 1,
  items: [
    {
      id: 'dsh-postgres-mcp',
      kind: 'bundle',
      displayName: 'dsh-postgres-mcp',
      summary: 'Postgres tools.',
      verified: true,
      deprecated: false,
      installs: 4,
    },
  ],
}

function stubDefault(): void {
  stubFetch({
    'GET /state': { body: STATE },
    'GET /catalog': { body: CATALOG },
    'GET /check-update': { body: { currentVersion: '0.4.2', latestVersion: '0.4.2', hasUpdate: false } },
  })
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('MarketPage', () => {
  it('renders the market identity and the profile it installs into', async () => {
    stubDefault()
    render(<MarketPage t={translate} />)

    expect(screen.getByRole('heading', { level: 1, name: 'dsh.fish market' })).toBeTruthy()
    await waitFor(() =>
      expect(screen.getByText(/into profile local-dsh/)).toBeTruthy(),
    )
  })

  it('opens on Discover and switches panels on tab click', async () => {
    stubDefault()
    render(<MarketPage t={translate} />)

    const discover = screen.getByRole('tab', { name: 'Discover' })
    const installed = screen.getByRole('tab', { name: 'Installed' })
    expect(discover.getAttribute('aria-selected')).toBe('true')
    expect(installed.getAttribute('aria-selected')).toBe('false')

    fireEvent.click(installed)

    expect(installed.getAttribute('aria-selected')).toBe('true')
    expect(discover.getAttribute('aria-selected')).toBe('false')
    expect(screen.getByRole('heading', { level: 2, name: 'Installed' })).toBeTruthy()
  })

  it('moves between tabs with the arrow keys', async () => {
    stubDefault()
    render(<MarketPage t={translate} />)

    const discover = screen.getByRole('tab', { name: 'Discover' })
    discover.focus()
    fireEvent.keyDown(discover, { key: 'ArrowRight' })

    expect(screen.getByRole('tab', { name: 'Installed' }).getAttribute('aria-selected')).toBe(
      'true',
    )

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Installed' }), { key: 'ArrowLeft' })
    expect(discover.getAttribute('aria-selected')).toBe('true')
  })

  it('keeps a visited panel mounted so its state survives a tab switch', async () => {
    // A storefront that remounts Discover would drop the reader's search text
    // every time they checked what was already installed.
    stubDefault()
    render(<MarketPage t={translate} />)

    await waitFor(() => expect(screen.getByText('dsh-postgres-mcp')).toBeTruthy())

    fireEvent.click(screen.getByRole('tab', { name: 'Account' }))
    const browsePanel = document.getElementById(
      screen.getByRole('tab', { name: 'Discover' }).getAttribute('aria-controls') ?? '',
    )
    expect(browsePanel?.hasAttribute('hidden')).toBe(true)
    // Still in the DOM, merely hidden — so a search the reader typed is intact
    // when they come back.
    expect(browsePanel?.querySelector('.dshFish__panelBody')).toBeTruthy()
  })

  it('marks the current tab as the only one in the tab order', async () => {
    stubDefault()
    render(<MarketPage t={translate} />)

    expect(screen.getByRole('tab', { name: 'Discover' }).getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('tab', { name: 'Installed' }).getAttribute('tabindex')).toBe('-1')
  })

  it('offers a way back to the conversation only when the shell can close it', async () => {
    stubDefault()
    const onClose = vi.fn()
    const { unmount } = render(<MarketPage t={translate} onClose={onClose} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to conversation' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    unmount()

    render(<MarketPage t={translate} />)
    expect(screen.queryByRole('button', { name: 'Back to conversation' })).toBeNull()
  })
})
