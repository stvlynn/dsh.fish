# UI Patterns

This document defines how UI is written in this project. The goal is a consistent, maintainable, and accessible interface.

## Language

- All user-facing copy must be in English unless the user explicitly asks for another language.
- All code, comments, prop names, and CSS custom properties must be in English.

## No hardcoded strings

- Every user-facing string must come from a centralized source: i18n keys, design-system tokens, or a constants file.
- Do not write labels, placeholders, or error messages directly in components.

```tsx
// ✅ Good
import { t } from 'shared/i18n';

<Button>{t('order.submit')}</Button>
```

```tsx
// ❌ Bad
<Button>Submit order</Button>
```

## No redundant copy

- Do not repeat information already shown by a title, icon, selected state, or surrounding section.
- Prefer concise labels over explanatory text when the state is self-evident.
- Remove disabled placeholder actions unless they teach a real next step.
- The home page is a catalog: search, type chips, and rails. Do not restate the product pitch, a kind glossary, or agent discovery docs — those live on `/docs`, `/kind/:kind`, and `/llms.txt`.

```tsx
// ❌ Bad
<div>
  <h1>Orders</h1>
  <p>This section shows your orders.</p>
</div>
```

```tsx
// ✅ Good
<div>
  <h1>{t('orders.title')}</h1>
  <OrderList />
</div>
```

## Semantic styling

- Use semantic design tokens instead of physical colors.
- ❌ Avoid: `bg-white`, `text-black`, `zinc-500`.
- ✅ Prefer: `bg-bg`, `text-text`, `border-border`, `text-muted`.
- Theme differences must live in one place (global theme file or CSS variables). Do not scatter `dark:` or media queries across components.

### The accent is the brand mark's hue

The palette is a near-neutral ground and exactly one accent. That accent is hue 263,
sampled from `icons/whale-brand.png` rather than chosen: the whale's body is
`oklch(0.529 0.257 263)` over 44% of the mark and its shadow is the same hue, and the
plugin tiles on the social card are drawn in it too. The whale's cyan belly is part
of the artwork, not a second accent this UI may spend.

Every neutral shares one cool hue (250), so the greys never disagree with each other
or look dirty under a blue accent. Dark mode's ground sits close to the social card's
own `oklch(0.148 0.035 242)`, so arriving from a shared link is continuous.

Do not add a token in a new hue. If a state needs distinguishing, use lightness,
weight or a glyph.

### Colour is scarce; shape is not

The accent is spent on two things only: the primary action and a verified badge. Do
not give a taxonomy entry a hue — six kind colours encode nothing a reader can learn
and compete with the one accent.

A glyph is the opposite trade and is encouraged: it is one mark per entry, it
survives translation into six languages where the word does not, and it stays
legible without colour vision. So a kind or a category is told apart by its word and
its mark, never by a colour.

Where a state does use the accent, it must also change shape or weight, so the state
is never carried by hue alone.

Trust signals are the one exception to the no-new-hue rule, and they spend muted
Tailwind hues, not tokens: a quality grade wears gold/emerald/sky/grey
(`GRADE_BADGE`) and a maintenance status wears its own muted border and text
(`MAINTENANCE_CHIP`). Here the hue *is* the information — "S is gold" is
learnable in a way "bundle is violet" was not — and the letter or word is always
rendered beside it, so nothing is carried by colour alone. Both maps live in
`entities/artifact/model/types.ts`; components never pick their own status hue.

### Every colour must be inside sRGB

`oklch()` accepts a chroma no display can produce, and the browser then gamut-maps
it — so the colour that ships is not the colour that was authored, and two tokens
authored at different chromas can silently render as the same thing. Three tokens
used to do this.

`app/styles/palette.test.ts` fails the build on that, on a contrast regression in any
pair the UI renders, on a token drifting off the accent or neutral hue, and on the
two copies of the dark block disagreeing. Change a token, run the frontend tests, and
then regenerate the social cards with
`pnpm --filter @dsh-fish/frontend run og:build` — they inline the same values.

## Functional icons

Every functional mark comes from [Phosphor](https://phosphoricons.com) through
`shared/ui/icon`. No component imports `@phosphor-icons/react` directly.

### One place names the marks

`shared/ui/icon/icons.ts` re-exports each glyph under the name of what it means —
`SearchIcon`, `VerifiedIcon`, `CliIcon`, `BundleIcon` — and is the only file that
mentions the library. Reach for a semantic alias, add one there when a new concept
needs a mark, and never introduce a second icon library.

One concept, one alias. Where two roles share a meaning they share the alias too;
a synonym would let the two drift apart. An install warning and a deprecated badge
are both `WarningIcon`.

### Weight follows the text beside it

A Phosphor weight is a fixed fraction of the rendered size, so the choice is a rule
rather than a judgement:

| Where the mark sits | Weight | Stroke |
| --- | --- | --- |
| Beside body copy at 400 | `regular` | 1.5px at 24px |
| Beside a label at 500–600, and on icon-only controls | `bold` | 2.25px at 24px |
| Selected, applied, or affirmed | `fill` | solid |

`ICON_WEIGHT` in `shared/ui/icon/icon.tsx` names these three roles. `regular` is the
document default; state the others at the call site.

`fill` is a state and not an emphasis. Colour must change with it, so a selected
filter, an active tab, the current navigation link and a verified badge are each
told apart twice — by shape and by colour — and neither channel carries the state
alone.

### Defaults come from the document, not the call site

`IconDefaults` wraps the app in `root.tsx` and supplies:

- `size="1em"`, so an unstyled glyph matches the cap height of its text. A `size-*`
  class still wins where a control needs an exact box.
- `color="currentColor"`, so hover, active and disabled are CSS colour changes on
  one SVG. Never a second asset per state.
- `aria-hidden`, because every mark here accompanies a visible label or an
  `aria-label` on its control. Do not repeat it at call sites. A mark that ever
  does need announcing overrides `aria-hidden` and passes `alt`.

### What earns a mark

A mark earns its place when it speeds recognition of a repeated, scannable item, or
when it names an action. Taxonomy entries and controls qualify; a section heading
that appears once does not, and neither does free text such as an artifact's
keywords, which has no taxonomy behind it to learn.

### Kinds and categories

`entities/artifact/model/icons.ts` owns the two taxonomy maps. `KIND_ICON` is keyed
by the `ArtifactKind` union, so a new kind fails the typecheck; category ids are
slugs and cannot be, so `icons.test.ts` walks the taxonomy instead and fails when it
grows past the map. `categoryIcon` returns `undefined` for an unmapped id rather
than a stand-in, which would look deliberate and hide the gap.

Kinds gain a shape and still no hue — see the colour rule below. Each mark names the
install mechanism the kind owns, and it follows that kind through the chip, the
filter rail, the footer, the home chips, the collection heading, the breadcrumb and
the docs tab. Do not use a different glyph for the same kind in a new place.

### Stateful marks

An icon that swaps with state goes through `shared/ui/icon-swap.tsx`, which
crossfades opacity, scale and blur on a bounceless spring and reduces to a plain
fade under `prefers-reduced-motion`. Do not hand-roll a second crossfade.

Motion is never the only channel. A swap always accompanies a changed label,
`aria-expanded`, or `aria-selected`.

Marks are otherwise static. Do not animate an icon that is only identifying
something.

### Hit areas

An icon-only control takes `.hit-area`, which extends the target to 44px under a
coarse pointer and 40px under a fine one without changing how the control looks.
Keep adjacent centres at least as far apart as the target is wide.

## Brand icons

The dsh.fish brand uses the generated, faceless blue-whale assets in
`frontend/public/icons/`, not handwritten inline SVG:

- Use `whale-brand.png` beside the product name and in generated social cards.
- Keep the whale itself free of marketplace metaphors. The plugin ecosystem is
  expressed at social-card scale by the central whale node, five surrounding
  plugin tiles, and their restrained orbital paths in
  `.github/assets/social-preview-background.png`.
- Do not add storefront, shopping, puzzle-piece, package-box, or install-arrow
  symbols to the whale mark.
- `whale-success.png` is the same mark at a compact size, used only for
  celebratory success states; do not introduce a second whale pose.
- Keep the image decorative when adjacent copy already names the product or
  state: use an empty `alt` and hide it from assistive technology.
- Generate PNG favicon derivatives from `whale-brand.png`; do not maintain a
  second hand-drawn logo in SVG. Google Search ignores icons smaller than
  48×48, so `favicon-48.png` and `favicon-96.png` sit next to the 32×32 file
  in `root.tsx` `links`. Regenerate them from the 256×256 mark if the whale
  changes.

This rule is limited to brand artwork. Functional controls use Phosphor through
`shared/ui/icon`, as above. Invisible SVG filter definitions and SVG
security/layout test fixtures are not icons and must remain structural code.

## Catalog card Social preview

A GitHub Social preview is a texture behind the card, not a second title.

- Render it only when `artifact.ogImageUrl` is present. Do not invent a placeholder image.
- Mark it decorative: `aria-hidden` on the layer, empty `alt` on the `img`.
- Drive opacity, blur, saturation and the scrim from `--artifact-og-*` in `app.css`.
- Hover may shift opacity only, only under `@media (hover: hover) and (pointer: fine)`, and not under `prefers-reduced-motion`.
- Animate `opacity` only. Do not animate `blur` or `transform` on hover.
- Light mode blurs harder and dims further than dark; on a white card the preview's bright areas otherwise read as stains.
- Anything sitting on the texture (grade badge, chips) needs an opaque fill — colour-mix tints over `--card`, never a bare `/10` alpha that smudges into the image.

## Author portraits

The plugin-page author card uses beui's `Avatar`, not a second image primitive.

- Construct the portrait from a GitHub *profile* URL as `https://github.com/{login}.png`. Do not store an arbitrary image URL on the author — that is the same tracker risk Social previews already refuse.
- A URL that is not a single-segment GitHub profile has no portrait. Initials inside the Avatar slot are what the primitive does when `src` is absent, not a second asset.
- Mark the image decorative: the name next to it is the accessible identity. `Avatar` already sets empty `alt` and `aria-hidden`.
- The author name belongs in this card. Do not also list it in the metrics row.
- The source link belongs under the portrait, in the same header column. Do not park it beside the install panel — that column is for installing, not for saying where the plugin came from.

## The toast stack

Three community invitations sit in one fixed deck at the bottom-right corner
(`shared/ui/motion/toast-stack.tsx`; `widgets/community-toasts` owns the
content and the dismissal). The deck mechanics are vendored from beui's
notification-stack — grid stacking, `layout="position"` reflow, and the
hover/tap/dismiss gesture hooks in `shared/lib/hooks` — and the toast
features (spring entrance, swipe dismissal, live region) from its animated
toast stack.

- **It is not a notification system.** There is one caller, no statuses and no
  timers. beui's neutral/info/loading/success/error vocabulary was dropped on
  the way in rather than left as unreachable options — this palette has no
  status hues to render it with.
- **It is a deck, not a list.** Collapsed, the front toast shows in full and
  the rest peek out above it, each a little smaller; a hover or focus anywhere
  on the stack fans it open. A permanent stack rendered as a flat list is a
  third of the viewport spent on invitations.
- **A finger gets the same deck as a pointer.** A tap on the collapsed stack
  fans it open, and an outside tap or Escape folds it — the registry's
  hover/tap/dismiss gesture hooks, vendored, are what keeps a tap from being
  read as a hover that arrives and leaves in the same gesture.
- **A toast is one line.** The mark, the title, then the action and the
  dismiss control grouped on the right. One glance, one row.
- **A toast leaves when a reader says so, and never comes back.** Dismissal is
  per toast and permanent, recorded in the `community` cookie so the root loader
  can decide the surface before it is rendered. Nothing auto-expires; an
  invitation that vanished while a reader was reaching for it would be worse
  than one they have to close.
- **Acting on a toast records the same dismissal but leaves it on screen.**
  Removing the anchor while the browser is still dispatching its click cancels
  the navigation it was clicked for, so the toast disappears on the next visit
  instead.
- **The action is an anchor.** Every destination a toast offers is a URL, and a
  real link is what gives it a middle click, a context menu and the right role.
- **It arrives late and leaves fast.** The stack waits ~900ms so the page has
  the first frame to itself, then the rows cascade in 70ms apart; the exit is
  180ms. Entrance is `SPRING_PANEL`, the deck's reflow is `SPRING_LAYOUT` —
  the same physics every other panel in the app settles on.
- **It exits the way it can be swiped.** A row leaves toward the right edge,
  which is the direction a swipe dismisses it (72px, or Sonner's 0.11px/ms
  flick). Enter is upward from the edge the stack is anchored to.
- **Reduced motion removes displacement, not the toast.** The fade stays,
  because it is what says the toast is new. The row transforms and the swipe
  come off; the deck's positioning is layout rather than motion, so it stays
  but lands instantly.
- **Elevation is one step above the popover's.** This is the only layer that
  floats over content the reader did not summon; at the popover's shadow, on a
  page of cards, it reads as one more card.

## Animated counts

User-facing counts (stars, downloads, the home total) go through
`shared/ui/animated-number.tsx`, which wraps `@number-flow/react`.

- Format with `compactNumberParts` in `shared/lib/format.ts`. Do not pass
  `notation: 'compact'` to NumberFlow — ICU compact notation hydrates
  differently on the Worker and in the browser.
- Pin `locales="en"` and explicit `minimumFractionDigits` / `maximumFractionDigits`.
- Keep `font-variant-numeric: tabular-nums` so changing digits do not shift layout.
- First paint is static. Do not add extra entrance motion around the number.

## Components are small and focused

- A component should do one thing.
- Extract a new component when a file grows beyond ~300 lines or when a block is reused.
- Components receive data and callbacks through props; they do not fetch their own data unless they live in a feature slice and that is the slice's explicit responsibility.

## Layout rules

- Use Flexbox to partition the screen into stable regions (header, content, footer).
- Only designated containers scroll. Do not allow the body or arbitrary containers to scroll.
- Set `min-height: 0` on every flex container that participates in the scroll chain, and `min-width: 0` on every grid or flex child that must shrink below its content's intrinsic size (a readme table, a code fence).
- The page root should fill the viewport (`min-h-dvh` / `h-dvh`).

## Accessibility

- Use semantic HTML (`button`, `a`, `label`, `nav`, `main`).
- Every interactive element must have an accessible name.
- Do not build fake buttons or links with `div` + click handlers.
