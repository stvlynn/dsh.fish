/**
 * dsh.fish in the harness settings.
 *
 * The browser half of the bundle: it renders a settings section and calls the
 * host routes this same package registers. It owns no install logic — the
 * installer, the catalog credentials and the account token stay host side, so
 * the section is a view over what the `hub_*` tools already do.
 *
 * Types come from the client type graph the harness browser client ships, not
 * from a plugin-local shim: `Context` is cordis's, while the three type-only
 * imports below augment that same `Context` with the `slots` and `locale`
 * services this module drives (`ui-renderer`, `dsh-client-locale`) and the
 * `settings.section` slot entry in `SlotMap` (`ui-settings`). They are erased
 * at build time; the services themselves arrive through `inject`.
 *
 * @module @dsh-fish/hub/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

import { HubSection } from './HubSection.js'
import { StorefrontIcon } from './Icons.js'
import { MarketPage } from './MarketPage.js'
import { dictionaries, LOCALE_NS, type HubLocaleKey, type HubTranslate } from './locale.js'
import { styles } from './styles.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** This section's copy, typed against the single dictionary in `locale.ts`. */
    'settings.dshFish': HubLocaleKey
  }
}

/** Panel key shared by the left-rail icon and the main-column page. */
export const PANEL_ID = 'dsh-fish-market'

export const inject = ['slots', 'locale']

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, dictionaries), 'dsh.fish: dictionaries')
  const t = ctx.locale.bind(LOCALE_NS)

  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset['plugin'] = '@dsh-fish/hub'
    style.textContent = styles
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh.fish: styles')

  // Settings keeps its section: the rail is the fast path for people who live
  // in the market, and the section is the one people find while already
  // configuring the harness. Both render the same panels over the same routes.
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register(
      {
        name: 'settings.section',
        id: 'dsh-fish',
        order: 30,
        label: () => t('nav'),
        locale: LOCALE_NS,
      },
      HubSection,
    ),
  )

  // The marketplace proper: an icon in the left rail's panel row, and the page
  // it selects in the main column. This is the harness's own navigation
  // pattern — the Plugins and Schedule panels are built exactly this way — so
  // the market sits beside them rather than inside a settings dialog.
  ctx.slots.inject('sidebar.panellist', () =>
    ctx.slots.register(
      {
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 20,
        label: () => t('panel.label'),
        locale: LOCALE_NS,
      },
      MarketPanelIcon,
    ),
  )

  ctx.slots.inject('main', () =>
    ctx.slots.register(
      {
        name: 'main',
        key: PANEL_ID,
        locale: LOCALE_NS,
        // The layout service is the only holder of panel-selection state, so
        // the page reaches it through the entry's own inject face rather than
        // expecting the shell to pass an owner prop it does not define.
        inject: () => ({ closeMarket: () => layoutOf(ctx)?.selectPanel(null) }),
      },
      MarketPageBound,
    ),
  )
}

/** The rail glyph: the harness owns the button, label and selected state. */
function MarketPanelIcon({ size }: { size: number }): JSX.Element {
  return <StorefrontIcon size={size} />
}

/**
 * The page occupant.
 *
 * `main` supplies no owner props: the translate function arrives from the
 * entry's declared `locale` namespace, and the close affordance from the
 * entry's inject face — never from the shell.
 */
function MarketPageBound({ t, closeMarket }: { t: HubTranslate; closeMarket: () => void }): JSX.Element {
  return <MarketPage t={t} onClose={closeMarket} />
}

/** The slice of `ctx.layout` this page drives. */
interface LayoutFace {
  selectPanel(panelId: string | null): void
}

/**
 * The layout service, when the composition provides one.
 *
 * Read through `ctx.get` rather than declared in `inject` so this plugin still
 * loads on a surface that has no layout (a headless profile has no client at
 * all, but a future embedding might have slots without a main column).
 */
function layoutOf(ctx: Context): LayoutFace | undefined {
  const layout = ctx.get('layout') as LayoutFace | undefined
  return typeof layout?.selectPanel === 'function' ? layout : undefined
}
