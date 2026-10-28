/**
 * Section styling, in the harness's own design tokens with robust fallbacks.
 *
 * `--dsw-alias-*` are the client's theme aliases. We define semantic local `--dsh-*`
 * tokens with fallbacks for both light and dark themes so components and modals never
 * render as transparent or unstyled.
 */
/**
 * Storefront chrome for the main-column market page.
 *
 * Kept separate from the settings-section rules above on purpose: the section
 * renders inside a settings modal at 760px, while the market owns the whole main
 * column and must fill it. Sharing one block would mean either the section
 * inherits full-bleed rules or the market inherits a max-width it cannot use.
 *
 * The page defines the same semantic tokens as `.dshFish`, because it is a
 * separate React root in a different part of the tree and cannot inherit them.
 */
const marketStyles = String.raw`
.dshFishMarket {
  --dsh-bg-primary: var(--dsw-alias-bg-primary, #ffffff);
  --dsh-bg-secondary: var(--dsw-alias-bg-secondary, #f4f4f6);
  --dsh-bg-card: var(--dsw-alias-bg-card, #ffffff);
  --dsh-bg-elevated: var(--dsw-alias-bg-elevated, #ffffff);
  --dsh-border-l1: var(--dsw-alias-border-l1, #e4e4e7);
  --dsh-border-l2: var(--dsw-alias-border-l2, #ebebee);
  --dsh-text-primary: var(--dsw-alias-label-primary, #18181b);
  --dsh-text-secondary: var(--dsw-alias-label-secondary, #52525b);
  --dsh-text-tertiary: var(--dsw-alias-label-tertiary, #71717a);
  --dsh-brand-primary: var(--dsw-alias-state-business-primary, #0070f3);

  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  color: var(--dsh-text-primary);
  background: var(--dsh-bg-primary);
}

@media (prefers-color-scheme: dark) {
  .dshFishMarket {
    --dsh-bg-primary: var(--dsw-alias-bg-primary, #18181b);
    --dsh-bg-secondary: var(--dsw-alias-bg-secondary, #222226);
    --dsh-bg-card: var(--dsw-alias-bg-card, #1f1f23);
    --dsh-bg-elevated: var(--dsw-alias-bg-elevated, #242428);
    --dsh-border-l1: var(--dsw-alias-border-l1, #3f3f46);
    --dsh-border-l2: var(--dsw-alias-border-l2, #2e2e33);
    --dsh-text-primary: var(--dsw-alias-label-primary, #f4f4f5);
    --dsh-text-secondary: var(--dsw-alias-label-secondary, #a1a1aa);
    --dsh-text-tertiary: var(--dsw-alias-label-tertiary, #71717a);
  }
}

[data-theme="dark"] .dshFishMarket,
.dark .dshFishMarket {
  --dsh-bg-primary: var(--dsw-alias-bg-primary, #18181b);
  --dsh-bg-secondary: var(--dsw-alias-bg-secondary, #222226);
  --dsh-bg-card: var(--dsw-alias-bg-card, #1f1f23);
  --dsh-bg-elevated: var(--dsw-alias-bg-elevated, #242428);
  --dsh-border-l1: var(--dsw-alias-border-l1, #3f3f46);
  --dsh-border-l2: var(--dsw-alias-border-l2, #2e2e33);
  --dsh-text-primary: var(--dsw-alias-label-primary, #f4f4f5);
  --dsh-text-secondary: var(--dsw-alias-label-secondary, #a1a1aa);
  --dsh-text-tertiary: var(--dsw-alias-label-tertiary, #71717a);
}

.dshFishMarket__header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 28px 14px;
  border-bottom: 1px solid var(--dsh-border-l2);
  flex: none;
}
.dshFishMarket__identity {
  display: flex;
  gap: 12px;
  align-items: center;
  min-width: 0;
}
.dshFishMarket__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  color: var(--dsh-brand-primary);
  background: var(--dsh-bg-secondary);
  flex: none;
}
.dshFishMarket__identityText {
  min-width: 0;
}
.dshFishMarket__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.3;
}
.dshFishMarket__subtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--dsh-text-secondary);
}
.dshFishMarket__close {
  flex: none;
  padding: 6px 12px;
  font-size: 12px;
  color: var(--dsh-text-secondary);
  background: transparent;
  border: 1px solid var(--dsh-border-l1);
  border-radius: 8px;
  cursor: pointer;
}
.dshFishMarket__close:hover {
  color: var(--dsh-text-primary);
  background: var(--dsh-bg-secondary);
}

.dshFishMarket__tabsRow {
  padding: 0 28px;
  border-bottom: 1px solid var(--dsh-border-l2);
  flex: none;
}
.dshFishMarket__tabs {
  display: flex;
  gap: 4px;
}
.dshFishMarket__tab {
  padding: 10px 4px;
  margin-bottom: -1px;
  font-size: 13px;
  font-weight: 500;
  color: var(--dsh-text-secondary);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.dshFishMarket__tab + .dshFishMarket__tab {
  margin-left: 16px;
}
.dshFishMarket__tab:hover {
  color: var(--dsh-text-primary);
}
.dshFishMarket__tab--active {
  color: var(--dsh-text-primary);
  border-bottom-color: var(--dsh-brand-primary);
}
.dshFishMarket__tab:focus-visible {
  outline: 2px solid var(--dsh-brand-primary);
  outline-offset: 2px;
  border-radius: 4px;
}

.dshFishMarket__body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 20px 28px 40px;
}
.dshFishMarket__pageHead {
  margin-bottom: 16px;
}
.dshFishMarket__pageTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}
.dshFishMarket__pageSubtitle {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--dsh-text-tertiary);
}

/* The panels were written for a settings column; give their content the full
   main-column width instead of the section's 760px cap. */
.dshFishMarket__panel > .dshFish {
  max-width: none;
}
.dshFishMarket__panel[hidden] {
  display: none;
}

@media (max-width: 720px) {
  .dshFishMarket__header,
  .dshFishMarket__tabsRow,
  .dshFishMarket__body {
    padding-left: 16px;
    padding-right: 16px;
  }
}
`

export const styles = String.raw`
/* Semantic tokens with solid fallbacks */
.dshFish,
.dshFish__modalOverlay {
  --dsh-bg-primary: var(--dsw-alias-bg-primary, #ffffff);
  --dsh-bg-secondary: var(--dsw-alias-bg-secondary, #f4f4f6);
  --dsh-bg-elevated: var(--dsw-alias-bg-elevated, #ffffff);
  --dsh-bg-modal: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-primary, #ffffff));
  --dsh-bg-card: var(--dsw-alias-bg-card, #ffffff);
  --dsh-border-l1: var(--dsw-alias-border-l1, #e4e4e7);
  --dsh-border-l2: var(--dsw-alias-border-l2, #ebebee);
  --dsh-text-primary: var(--dsw-alias-label-primary, #18181b);
  --dsh-text-secondary: var(--dsw-alias-label-secondary, #52525b);
  --dsh-text-tertiary: var(--dsw-alias-label-tertiary, #71717a);
  --dsh-brand-primary: var(--dsw-alias-state-business-primary, #0070f3);
  --dsh-code-bg: var(--dsw-alias-bg-secondary, #f4f4f6);
}

@media (prefers-color-scheme: dark) {
  .dshFish,
  .dshFish__modalOverlay {
    --dsh-bg-primary: var(--dsw-alias-bg-primary, #18181b);
    --dsh-bg-secondary: var(--dsw-alias-bg-secondary, #222226);
    --dsh-bg-elevated: var(--dsw-alias-bg-elevated, #242428);
    --dsh-bg-modal: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-primary, #1e1e22));
    --dsh-bg-card: var(--dsw-alias-bg-card, #1f1f23);
    --dsh-border-l1: var(--dsw-alias-border-l1, #3f3f46);
    --dsh-border-l2: var(--dsw-alias-border-l2, #2e2e33);
    --dsh-text-primary: var(--dsw-alias-label-primary, #f4f4f5);
    --dsh-text-secondary: var(--dsw-alias-label-secondary, #a1a1aa);
    --dsh-text-tertiary: var(--dsw-alias-label-tertiary, #71717a);
    --dsh-brand-primary: var(--dsw-alias-state-business-primary, #0070f3);
    --dsh-code-bg: var(--dsw-alias-bg-secondary, #242428);
  }
}

[data-theme="dark"] .dshFish,
[data-theme="dark"] .dshFish__modalOverlay,
.dark .dshFish,
.dark .dshFish__modalOverlay {
  --dsh-bg-primary: var(--dsw-alias-bg-primary, #18181b);
  --dsh-bg-secondary: var(--dsw-alias-bg-secondary, #222226);
  --dsh-bg-elevated: var(--dsw-alias-bg-elevated, #242428);
  --dsh-bg-modal: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-primary, #1e1e22));
  --dsh-bg-card: var(--dsw-alias-bg-card, #1f1f23);
  --dsh-border-l1: var(--dsw-alias-border-l1, #3f3f46);
  --dsh-border-l2: var(--dsw-alias-border-l2, #2e2e33);
  --dsh-text-primary: var(--dsw-alias-label-primary, #f4f4f5);
  --dsh-text-secondary: var(--dsw-alias-label-secondary, #a1a1aa);
  --dsh-text-tertiary: var(--dsw-alias-label-tertiary, #71717a);
  --dsh-brand-primary: var(--dsw-alias-state-business-primary, #0070f3);
  --dsh-code-bg: var(--dsw-alias-bg-secondary, #242428);
}

.dshFish {
  max-width: 760px;
  color: var(--dsh-text-primary);
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dshFish__header {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.dshFish__headerTitleRow {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dshFish__heading {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.dshFish__versionBadge {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 999px;
  background: var(--dsh-bg-secondary);
  border: 1px solid var(--dsh-border-l2);
  color: var(--dsh-text-secondary);
  font-family: monospace;
}
.dshFish__checkUpdateBtn {
  border: 1px solid var(--dsh-border-l2);
  background: transparent;
  color: var(--dsh-text-secondary);
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  transition: all 0.15s ease;
}
.dshFish__checkUpdateBtn:hover:not(:disabled) {
  color: var(--dsh-text-primary);
  background: var(--dsh-bg-secondary);
  border-color: var(--dsh-border-l1);
}
.dshFish__checkUpdateBtn:disabled {
  opacity: 0.6;
  cursor: default;
}
.dshFish__updateBanner {
  margin-top: 4px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(0, 112, 243, 0.08);
  border: 1px solid rgba(0, 112, 243, 0.25);
  color: var(--dsh-text-primary);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 12.5px;
  font-weight: 500;
}
.dshFish__intro {
  margin: 0;
  color: var(--dsh-text-tertiary);
  font-size: 13px;
  line-height: 1.5;
}
.dshFish__tabs {
  border-bottom: 1px solid var(--dsh-border-l2);
  display: flex;
  align-items: flex-end;
  gap: 22px;
  margin-top: 2px;
}
.dshFish__tab {
  border: 0;
  padding: 8px 2px 10px;
  position: relative;
  background: transparent;
  color: var(--dsh-text-tertiary);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  cursor: pointer;
  transition: color 0.15s ease;
}
.dshFish__tab:hover,
.dshFish__tab[data-active="true"] {
  color: var(--dsh-text-primary);
}
.dshFish__tab[data-active="true"]::after,
.dshFish__tab:focus-visible::after {
  content: "";
  height: 2px;
  border-radius: 2px 2px 0 0;
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  background: var(--dsh-text-primary);
}
.dshFish__tab:focus-visible {
  border-radius: 2px;
  outline: 2px solid var(--dsh-brand-primary);
  outline-offset: 2px;
}
.dshFish__panel {
  min-width: 0;
  padding-top: 2px;
}
.dshFish__panelBody {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.dshFish__search {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dshFish__input,
.dshFish__select {
  border: 1px solid var(--dsh-border-l2);
  border-radius: 8px;
  padding: 7px 11px;
  background: var(--dsh-bg-primary);
  color: var(--dsh-text-primary);
  font: inherit;
  font-size: 13px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.dshFish__input:focus,
.dshFish__select:focus {
  outline: none;
  border-color: var(--dsh-brand-primary);
  box-shadow: 0 0 0 2px rgba(0, 112, 243, 0.15);
}
.dshFish__input {
  flex: 1 1 220px;
  min-width: 0;
}
.dshFish__button,
.dshFish__buttonQuiet {
  border: 1px solid var(--dsh-border-l2);
  border-radius: 8px;
  padding: 6px 13px;
  background: var(--dsh-bg-secondary);
  color: var(--dsh-text-primary);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  transition: all 0.15s ease;
}
.dshFish__button:hover:not(:disabled) {
  background: var(--dsh-bg-primary);
  border-color: var(--dsh-border-l1);
}
.dshFish__button:disabled,
.dshFish__buttonQuiet:disabled {
  opacity: 0.55;
  cursor: default;
}
.dshFish__button--sm {
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 6px;
}
.dshFish__buttonQuiet {
  background: transparent;
  color: var(--dsh-text-secondary);
}
.dshFish__buttonQuiet:hover:not(:disabled) {
  background: var(--dsh-bg-secondary);
  color: var(--dsh-text-primary);
}
.dshFish__button--primary {
  background: var(--dsh-brand-primary);
  border-color: var(--dsh-brand-primary);
  color: #ffffff;
}
.dshFish__button--primary:hover:not(:disabled) {
  background: var(--dsh-brand-primary);
  filter: brightness(1.1);
  border-color: transparent;
  color: #ffffff;
}
.dshFish__button--destructive {
  color: #dc2626;
  border-color: rgba(220, 38, 38, 0.25);
}
.dshFish__button--destructive:hover:not(:disabled) {
  background: rgba(220, 38, 38, 0.08);
  border-color: #dc2626;
  color: #dc2626;
}

@keyframes dshFishSpin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
.dshFish__spin {
  animation: dshFishSpin 0.75s linear infinite;
  display: inline-block;
  flex-shrink: 0;
}

.dshFish__list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dshFish__card {
  border: 1px solid var(--dsh-border-l2);
  border-radius: 12px;
  padding: 14px 16px;
  background-color: var(--dsh-bg-card);
  color: var(--dsh-text-primary);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}
.dshFish__card--clickable {
  cursor: pointer;
}
.dshFish__card--clickable:hover {
  border-color: var(--dsh-brand-primary);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}
.dshFish__card--clickable:focus-visible {
  outline: 2px solid var(--dsh-brand-primary);
  outline-offset: 2px;
}
.dshFish__cardHead {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.dshFish__cardName {
  font-size: 14.5px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--dsh-text-primary);
}
.dshFish__cardSummary {
  margin: 0;
  color: var(--dsh-text-secondary);
  font-size: 13px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.dshFish__cardFoot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  margin-top: 4px;
}
.dshFish__cardActions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}
.dshFish__tag {
  border-radius: 999px;
  padding: 1.5px 8px;
  font-size: 11px;
  font-weight: 500;
  line-height: 18px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dshFish__tag--kind {
  background: var(--dsh-bg-secondary);
  border: 1px solid var(--dsh-border-l2);
  color: var(--dsh-text-secondary);
}
.dshFish__tag--verified {
  background: rgba(0, 112, 243, 0.08);
  color: var(--dsh-brand-primary);
  border: 1px solid rgba(0, 112, 243, 0.22);
}
.dshFish__tag--deprecated {
  background: rgba(220, 38, 38, 0.08);
  color: #dc2626;
  border: 1px solid rgba(220, 38, 38, 0.22);
}
.dshFish__tag--ai {
  background: rgba(147, 51, 234, 0.08);
  color: #9333ea;
  border: 1px solid rgba(147, 51, 234, 0.22);
}
.dshFish__meta,
.dshFish__empty {
  margin: 0;
  color: var(--dsh-text-tertiary);
  font-size: 12px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dshFish__link {
  color: var(--dsh-brand-primary);
  font-size: 12px;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.dshFish__link:hover {
  text-decoration: underline;
}
.dshFish__link--source {
  font-weight: 500;
}
.dshFish__warning,
.dshFish__error {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
}
.dshFish__warning {
  color: var(--dsh-text-secondary);
}
.dshFish__error {
  color: #dc2626;
}
.dshFish__notice {
  margin: 0;
  color: var(--dsh-text-secondary);
  font-size: 12px;
}
.dshFish__device {
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  padding: 12px;
  background: var(--dsh-bg-secondary);
  border: 1px solid var(--dsh-border-l2);
  border-radius: 10px;
}
.dshFish__code {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0.05em;
  font-family: monospace;
}
.dshFish__waitingRow {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dshFish__signedOut {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-items: flex-start;
}

/* Avatar Component */
.dshFish__avatar {
  border-radius: 50%;
  overflow: hidden;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--dsh-bg-secondary);
  border: 1px solid var(--dsh-border-l2);
  color: var(--dsh-text-primary);
  flex-shrink: 0;
  user-select: none;
}
.dshFish__avatarImg {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.dshFish__avatarInitial {
  font-size: 16px;
  font-weight: 600;
  line-height: 1;
}

/* Tooltip Component */
.dshFish__tooltipWrapper {
  position: relative;
  display: inline-flex;
  align-items: center;
}
.dshFish__avatarTrigger {
  cursor: pointer;
  display: inline-flex;
  border-radius: 50%;
  transition: transform 0.15s ease;
}
.dshFish__avatarTrigger:hover {
  transform: scale(1.04);
}
.dshFish__tooltip {
  position: absolute;
  z-index: 1000;
  padding: 5px 9px;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
  pointer-events: none;
  background: var(--dsh-bg-secondary);
  color: var(--dsh-text-primary);
  border: 1px solid var(--dsh-border-l1);
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  opacity: 0;
  animation: dshFishTooltipFade 0.15s cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.dshFish__tooltip--top {
  bottom: calc(100% + 7px);
  left: 50%;
  transform: translateX(-50%);
}
.dshFish__tooltip--bottom {
  top: calc(100% + 7px);
  left: 50%;
  transform: translateX(-50%);
}
@keyframes dshFishTooltipFade {
  from { opacity: 0; transform: translate(-50%, 3px); }
  to { opacity: 1; transform: translate(-50%, 0); }
}

/* Account Card */
.dshFish__accountCard {
  border: 1px solid var(--dsh-border-l2);
  border-radius: 12px;
  padding: 16px 18px;
  background: var(--dsh-bg-card);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}
.dshFish__accountInfo {
  display: flex;
  align-items: center;
  gap: 14px;
}
.dshFish__accountText {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dshFish__accountName {
  font-size: 15px;
  font-weight: 600;
  color: var(--dsh-text-primary);
}
.dshFish__accountSub {
  font-size: 12px;
  color: var(--dsh-text-tertiary);
}

/* Plugin Maintenance Section */
.dshFish__pluginSection {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dshFish__sectionTitle {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--dsh-text-secondary);
}
.dshFish__pluginCard {
  border: 1px solid var(--dsh-border-l2);
  border-radius: 12px;
  padding: 14px 16px;
  background: var(--dsh-bg-card);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}
.dshFish__pluginInfo {
  display: flex;
  align-items: center;
  gap: 10px;
}
.dshFish__pluginName {
  font-size: 13.5px;
  font-weight: 600;
  font-family: monospace;
  color: var(--dsh-text-primary);
}
.dshFish__pluginActions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Modal Dialog - Rock solid non-transparent background */
.dshFish__modalOverlay {
  position: fixed;
  inset: 0;
  z-index: 99999;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.dshFish__modal {
  background-color: var(--dsh-bg-modal);
  color: var(--dsh-text-primary);
  border: 1px solid var(--dsh-border-l1);
  border-radius: 14px;
  box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.4), 0 0 0 1px var(--dsh-border-l1);
  width: 100%;
  max-width: 820px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: dshFishModalEnter 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
@keyframes dshFishModalEnter {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
.dshFish__modalHead {
  padding: 16px 22px;
  border-bottom: 1px solid var(--dsh-border-l2);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background-color: var(--dsh-bg-modal);
  color: var(--dsh-text-primary);
}
.dshFish__modalHeadTitle {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.dshFish__modalTitle {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--dsh-text-primary);
  overflow-wrap: break-word;
}
.dshFish__modalBadges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.dshFish__modalHeadActions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}
.dshFish__modalClose {
  border: 0;
  background: transparent;
  cursor: pointer;
  color: var(--dsh-text-tertiary);
  padding: 6px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: all 0.15s ease;
}
.dshFish__modalClose:hover {
  color: var(--dsh-text-primary);
  background: var(--dsh-bg-secondary);
}
.dshFish__modalMeta {
  padding: 12px 22px;
  background-color: var(--dsh-bg-secondary);
  border-bottom: 1px solid var(--dsh-border-l2);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dshFish__modalSummary {
  margin: 0;
  font-size: 13px;
  color: var(--dsh-text-secondary);
  line-height: 1.5;
}
.dshFish__modalMetaRow {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 12px;
}
.dshFish__modalBody {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
  min-height: 200px;
  background-color: var(--dsh-bg-modal);
  color: var(--dsh-text-primary);
}
.dshFish__modalLoading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 56px 0;
  color: var(--dsh-text-tertiary);
  font-size: 13px;
}

/* Markdown Prose in Readme Modal */
.dshFish__prose {
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--dsh-text-primary);
  word-break: break-word;
}
.dshFish__h1 { font-size: 21px; font-weight: 700; margin: 20px 0 10px; border-bottom: 1px solid var(--dsh-border-l2); padding-bottom: 8px; color: var(--dsh-text-primary); }
.dshFish__h2 { font-size: 18px; font-weight: 600; margin: 18px 0 8px; border-bottom: 1px solid var(--dsh-border-l2); padding-bottom: 6px; color: var(--dsh-text-primary); }
.dshFish__h3 { font-size: 15.5px; font-weight: 600; margin: 15px 0 6px; color: var(--dsh-text-primary); }
.dshFish__h4 { font-size: 14px; font-weight: 600; margin: 12px 0 4px; color: var(--dsh-text-primary); }
.dshFish__h5, .dshFish__h6 { font-size: 13px; font-weight: 600; margin: 10px 0 4px; color: var(--dsh-text-primary); }
.dshFish__p { margin: 10px 0; line-height: 1.7; color: var(--dsh-text-primary); }
.dshFish__codeInline {
  background: var(--dsh-code-bg);
  border: 1px solid var(--dsh-border-l2);
  border-radius: 4px;
  padding: 2px 6px;
  font-family: monospace;
  font-size: 0.9em;
  color: var(--dsh-text-primary);
}
.dshFish__codeBlock {
  margin: 14px 0;
  border: 1px solid var(--dsh-border-l2);
  border-radius: 8px;
  overflow: hidden;
  background: var(--dsh-code-bg);
}
.dshFish__codeBlockHead {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--dsh-border-l2);
  background: var(--dsh-bg-primary);
  font-size: 11px;
  color: var(--dsh-text-tertiary);
}
.dshFish__codeLang {
  font-family: monospace;
  text-transform: lowercase;
}
.dshFish__codeCopyBtn {
  border: 0;
  background: transparent;
  color: var(--dsh-text-tertiary);
  font-size: 11px;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
  transition: all 0.15s ease;
}
.dshFish__codeCopyBtn:hover {
  color: var(--dsh-text-primary);
  background: var(--dsh-bg-secondary);
}
.dshFish__pre {
  margin: 0;
  padding: 14px;
  overflow-x: auto;
  font-family: monospace;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--dsh-text-primary);
}
.dshFish__ul, .dshFish__ol {
  margin: 10px 0;
  padding-left: 22px;
}
.dshFish__ul li, .dshFish__ol li {
  margin: 4px 0;
  line-height: 1.6;
}
.dshFish__taskItem {
  list-style: none;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 4px 0;
}
.dshFish__checkbox {
  margin-top: 4px;
  cursor: default;
}
.dshFish__blockquote {
  margin: 12px 0;
  padding: 6px 14px;
  border-left: 3px solid var(--dsh-brand-primary);
  background: var(--dsh-bg-secondary);
  border-radius: 0 6px 6px 0;
  color: var(--dsh-text-secondary);
}
.dshFish__hr {
  border: 0;
  border-top: 1px solid var(--dsh-border-l2);
  margin: 20px 0;
}
.dshFish__tableWrapper {
  margin: 14px 0;
  overflow-x: auto;
  border: 1px solid var(--dsh-border-l2);
  border-radius: 8px;
}
.dshFish__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}
.dshFish__table th, .dshFish__table td {
  padding: 8px 12px;
  border-bottom: 1px solid var(--dsh-border-l2);
  text-align: left;
}
.dshFish__table th {
  background: var(--dsh-bg-secondary);
  font-weight: 600;
  color: var(--dsh-text-primary);
}
.dshFish__table tr:last-child td {
  border-bottom: 0;
}
.dshFish__proseImg {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 10px 0;
  display: block;
}
.dshFish__badgeImg {
  display: inline-block;
  vertical-align: middle;
  height: auto;
  max-height: 24px;
}
.dshFish__badgeLink {
  display: inline-block;
  vertical-align: middle;
  margin: 2px 4px 2px 0;
}
.dshFish__srOnly {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
${marketStyles}
`
