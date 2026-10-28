/**
 * The dsh.fish market page, hosted in the harness's main column.
 *
 * This is the same surface the Settings section renders, given the room a
 * storefront needs: a full-width header, a top-level tab bar, and the three
 * panels at the main column's width instead of a settings page's 760px.
 *
 * The panels themselves are imported, not reimplemented. `BrowseTab`,
 * `InstalledTab` and `AccountTab` are the components the Settings section
 * already renders, and both surfaces write through the same host routes, so an
 * install started here and one started in Settings are the same install. What
 * this file owns is only the chrome: the frame, the tab switch, and the
 * "back to conversation" affordance that a settings modal provides for free by
 * having a Close button.
 *
 * @module @dsh-fish/hub/client/market
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { AccountTab } from './AccountTab.js'
import { BrowseTab } from './BrowseTab.js'
import { InstalledTab } from './InstalledTab.js'
import { StorefrontIcon } from './Icons.js'
import type { HubTranslate } from './locale.js'
import { request, type HubState } from './api.js'

type TabId = 'browse' | 'installed' | 'account'

const TAB_IDS: readonly TabId[] = ['browse', 'installed', 'account']

/** Props the main slot's renderer supplies to a keyed panel occupant. */
export interface MarketPageProps {
  /** Locale-bound translate for this plugin's dictionary. */
  readonly t: HubTranslate
  /**
   * Return to the conversation. The layout's panel selection is the shell's
   * state, so leaving the page is a callback rather than a link: only the
   * composition knows what "back" means.
   */
  readonly onClose?: () => void
}

/**
 * Render the market: tab bar, page header, and the selected panel.
 *
 * @param props - the translate function and an optional close affordance.
 * @returns the market page.
 */
export function MarketPage({ t, onClose }: MarketPageProps): JSX.Element {
  const tabsId = useId()
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [activeId, setActiveId] = useState<TabId>('browse')
  const [visitedIds, setVisitedIds] = useState<ReadonlySet<TabId>>(() => new Set(['browse']))
  const [profile, setProfile] = useState<string | undefined>(undefined)

  useEffect(() => {
    request<HubState>('/state').then(
      (state) => {
        setProfile(state.profile)
      },
      () => undefined,
    )
  }, [])

  // A panel mounts on first visit and stays mounted afterwards: the catalog
  // keeps its search and the Installed list keeps its scroll position when the
  // reader switches tabs, which is what every storefront does.
  useEffect(() => {
    setVisitedIds((previous) => {
      if (previous.has(activeId)) return previous
      return new Set([...previous, activeId])
    })
  }, [activeId])

  const selectTab = useCallback((next: TabId) => {
    setActiveId(next)
  }, [])

  const onTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = TAB_IDS.indexOf(activeId)
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TAB_IDS.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TAB_IDS.length) % TAB_IDS.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = TAB_IDS.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    const next = TAB_IDS[nextIndex]
    if (next === undefined) return
    setActiveId(next)
    tabRefs.current[nextIndex]?.focus()
  }, [activeId])

  const subtitle = (id: TabId): string => {
    if (id === 'browse') return t('market.browse.subtitle')
    if (id === 'installed') return t('market.installed.subtitle')
    return t('market.account.subtitle')
  }

  const heading = (id: TabId): string => {
    if (id === 'browse') return t('market.browse.title')
    if (id === 'installed') return t('market.installed.title')
    return t('market.account.title')
  }

  return (
    <section className="dshFishMarket">
      <header className="dshFishMarket__header">
        <div className="dshFishMarket__identity">
          <span className="dshFishMarket__mark" aria-hidden="true">
            <StorefrontIcon size={22} />
          </span>
          <div className="dshFishMarket__identityText">
            <h1 className="dshFishMarket__title">{t('market.title')}</h1>
            <p className="dshFishMarket__subtitle">
              {t('market.subtitle', { profile: profile ?? '…' })}
            </p>
          </div>
        </div>
        {onClose !== undefined && (
          <button className="dshFishMarket__close" type="button" onClick={onClose}>
            {t('market.close')}
          </button>
        )}
      </header>

      <div className="dshFishMarket__tabsRow">
        <div
          className="dshFishMarket__tabs"
          role="tablist"
          aria-label={t('tabs.aria')}
          onKeyDown={onTabKeyDown}
        >
          {TAB_IDS.map((id, index) => {
            const selected = id === activeId
            return (
              <button
                key={id}
                ref={(element) => {
                  tabRefs.current[index] = element
                }}
                id={`${tabsId}-tab-${id}`}
                className={
                  selected
                    ? 'dshFishMarket__tab dshFishMarket__tab--active'
                    : 'dshFishMarket__tab'
                }
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`${tabsId}-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  selectTab(id)
                }}
              >
                {t(`market.tab.${id}` as 'market.tab.browse')}
              </button>
            )
          })}
        </div>
      </div>

      <div className="dshFishMarket__body">
        <div className="dshFishMarket__pageHead">
          <h2 className="dshFishMarket__pageTitle">{heading(activeId)}</h2>
          <p className="dshFishMarket__pageSubtitle">{subtitle(activeId)}</p>
        </div>

        {TAB_IDS.map((id) =>
          visitedIds.has(id) ? (
            <div
              key={id}
              id={`${tabsId}-panel-${id}`}
              role="tabpanel"
              aria-labelledby={`${tabsId}-tab-${id}`}
              hidden={id !== activeId}
              className="dshFishMarket__panel"
            >
              {id === 'browse' && <BrowseTab t={t} />}
              {id === 'installed' && <InstalledTab t={t} />}
              {id === 'account' && <AccountTab t={t} />}
            </div>
          ) : null,
        )}
      </div>
    </section>
  )
}
