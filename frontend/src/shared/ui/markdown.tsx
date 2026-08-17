import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import type { Components, ExtraProps, UrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CopyButton, REVEAL_ON_HOVER } from '@/shared/ui/copy-button'
import { cn } from '@/shared/lib/utils'

type Node = NonNullable<ExtraProps['node']>

/**
 * Third-party markdown, rendered.
 *
 * SAFETY. This renders a crawl of somebody else's repository, so the previous
 * version showed the source in a `<pre>` rather than become an injection vector
 * for every indexed repo. Rendering is safe here for three reasons, all of them
 * structural rather than a sanitiser pass we have to keep ahead of attackers:
 *
 * 1. No markup ever reaches the DOM. `react-markdown` builds React elements
 *    from an AST — there is no `dangerouslySetInnerHTML` anywhere in the path —
 *    and `skipHtml` drops raw HTML nodes instead of passing them through.
 * 2. Every URL goes through `defaultUrlTransform`, which allows only http,
 *    https, mailto, irc and xmpp. A `javascript:` href is emptied at the AST.
 * 3. Only the tags mapped below can be produced, and each one is rendered by
 *    our own component with our own props.
 *
 * `skipHtml` costs us the presentational HTML some readmes wrap themselves in
 * (`<p align="center">`, `<img>` badge rows). Dropping those tags loses the
 * layout but keeps the prose; the alternative — printing the tags as literal
 * text, which is what happens with `skipHtml` off — loses the prose too.
 */
export function Markdown({
  source,
  docBase,
  assetBase,
  className,
}: {
  source: string
  /** Base a relative link resolves against. Relative links drop without one. */
  docBase?: string
  /** Base a relative image resolves against. Relative images drop without one. */
  assetBase?: string
  className?: string
}) {
  return (
    <div className={cn(PROSE, className)}>
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        components={COMPONENTS}
        urlTransform={urlTransform(docBase, assetBase)}
      >
        {source}
      </ReactMarkdown>
    </div>
  )
}

/**
 * Container-level rules, for the two cases a per-tag component cannot see.
 *
 * An image standing alone in its own paragraph is a screenshot and takes the
 * hairline outline that gives a flat image an edge; an image sharing a
 * paragraph is a badge or an inline glyph, where that outline would read as
 * dirt around it. Only a selector knows which is which. The outline is pure
 * black and pure white rather than a tinted neutral — a tinted one picks up the
 * surface behind it and looks like a smudge on the image.
 *
 * Nested lists get their vertical margin removed, which is a parent-child
 * relationship the `ul` component cannot see either.
 */
const PROSE = cn(
  // `break-words`: a readme is full of tokens with no break opportunity — bare
  // URLs, snake_case env names — and on a phone one of them is wider than the
  // screen. Breaking mid-token is the lesser evil against a line that leaves
  // the viewport. `overflow-wrap` inherits, but a code fence is unaffected
  // because `white-space: pre` means it never wraps at all; it scrolls inside
  // its own box instead, which is what a copyable command wants.
  'text-[15px] leading-7 text-foreground/90 break-words',
  '[&_p>img:only-child]:my-2 [&_p>img:only-child]:rounded-xl',
  '[&_p>img:only-child]:outline [&_p>img:only-child]:outline-1',
  '[&_p>img:only-child]:outline-black/10 dark:[&_p>img:only-child]:outline-white/10',
  '[&_li>ul]:my-1.5 [&_li>ol]:my-1.5',
)

/**
 * Heading levels, demoted by two.
 *
 * The page owns `<h1>` (the artifact name) and the section owns `<h2>`, so a
 * readme's own `#` is a third-level heading in this document however large it
 * renders. Demoting keeps the outline a screen reader announces truthful while
 * leaving the visual scale free to say "top of the readme".
 */
const HEADINGS = [
  { tag: 'h3', className: 'mt-12 mb-4 text-2xl font-semibold tracking-tight text-balance' },
  // A rule above the second level is what makes a long readme scannable: it is
  // the only mark that says where one section ends rather than where the next
  // begins. Nothing below that level gets one, or the page becomes a ladder.
  {
    tag: 'h4',
    className:
      'mt-11 mb-4 border-t border-border pt-8 text-lg font-semibold tracking-tight text-balance first:border-0 first:pt-0',
  },
  { tag: 'h5', className: 'mt-8 mb-2 text-base font-semibold tracking-tight text-balance' },
  { tag: 'h6', className: 'mt-7 mb-2 text-sm font-semibold tracking-tight' },
  { tag: 'h6', className: 'mt-6 mb-2 text-sm font-medium tracking-tight' },
  { tag: 'h6', className: 'mt-6 mb-2 text-sm font-medium tracking-tight text-muted-foreground' },
] as const

function heading(level: number) {
  return function Heading({ node, children }: { children?: React.ReactNode } & ExtraProps) {
    const { tag: Tag, className } = HEADINGS[level - 1] ?? HEADINGS[5]
    // A readme that carries its own table of contents links to `#its-headings`,
    // so the ids have to exist for those links to land anywhere. `scroll-mt`
    // clears the 64px sticky header, which the jump would otherwise park the
    // heading underneath — an anchor that lands on the wrong line is worse than
    // one that does not resolve, because the reader has no way of telling.
    return (
      <Tag
        id={node === undefined ? undefined : slug(nodeText(node))}
        className={cn(className, 'scroll-mt-20 first:mt-0')}
      >
        {children}
      </Tag>
    )
  }
}

const COMPONENTS: Components = {
  h1: heading(1),
  h2: heading(2),
  h3: heading(3),
  h4: heading(4),
  h5: heading(5),
  h6: heading(6),

  p: ({ children }) => <p className="my-4 text-pretty first:mt-0 last:mb-0">{children}</p>,

  // Links carry no colour. The one accent on this site marks the primary action
  // and a verified badge; spending it on every link in a third-party readme
  // would drown both. An underline is the older and stronger signal anyway, and
  // unlike colour it survives a reader who cannot distinguish hue.
  a: ({ href, children }) =>
    isLinkable(href) ? (
      <a
        href={href}
        {...(href.startsWith('#')
          ? {}
          : // `nofollow`: a catalog should not lend its rank to every crawled repo.
            { target: '_blank', rel: 'noreferrer noopener nofollow' })}
        className="font-medium text-foreground underline decoration-border-strong underline-offset-[3px] transition-colors hover:decoration-foreground"
      >
        {children}
      </a>
    ) : (
      // An unresolvable relative link would point at this site and 404. Its text
      // is still the author's, so it stays; only the false affordance goes.
      <>{children}</>
    ),

  img: ({ src, alt }) =>
    typeof src === 'string' && /^https?:/i.test(src) ? (
      <img
        src={src}
        alt={alt ?? ''}
        loading="lazy"
        decoding="async"
        className="inline-block max-w-full align-middle"
      />
    ) : null,

  ul: ({ className, children }) => (
    <ul
      className={cn(
        'my-4 space-y-1.5',
        // remark-gfm marks a task list; its checkboxes are the markers.
        className?.includes('contains-task-list')
          ? 'list-none pl-0'
          : 'list-disc pl-5 marker:text-muted-foreground',
      )}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 list-decimal space-y-1.5 pl-5 marker:tabular-nums marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="text-pretty">{children}</li>,
  input: ({ checked, type }) =>
    type === 'checkbox' ? (
      <input
        type="checkbox"
        checked={checked}
        readOnly
        // `readOnly` rather than `disabled`: the box is a rendering of the
        // author's list, not a control, but a disabled box also drops out of
        // the tab order and greys past our contrast floor.
        className="mr-2 size-3.5 align-middle accent-primary"
      />
    ) : null,

  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-border-strong pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),

  pre: ({ node, children }) => (
    <CodeFence code={node === undefined ? '' : nodeText(node)}>{children}</CodeFence>
  ),
  code: ({ children }) => (
    // Fenced code arrives inside `pre`, which already set the type; this only
    // has to stay transparent there and stand out inline everywhere else.
    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em] [pre_&]:bg-transparent [pre_&]:p-0 [pre_&]:text-[13px]">
      {children}
    </code>
  ),

  hr: () => <hr className="my-8 border-t border-border" />,

  // A readme table is arbitrarily wide and the page is not. Scrolling the table
  // alone keeps the page itself from scrolling sideways.
  table: ({ children }) => (
    // The wrapper draws the frame, so the last row must not draw a rule under
    // itself onto it. Only a selector can tell which row is last.
    <div className="my-5 overflow-x-auto rounded-xl border border-border [&_tbody_tr:last-child>td]:border-0 [scrollbar-width:thin]">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  // `style` carries the column alignment the author wrote into the delimiter row.
  th: ({ children, style }) => (
    <th style={style} className="border-b border-border bg-muted/50 px-3 py-2 text-left font-medium">
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td style={style} className="border-b border-border px-3 py-2 align-top">
      {children}
    </td>
  ),
}

/** A code fence, with the copy affordance the reader came for. */
function CodeFence({ code, children }: { code: string; children?: React.ReactNode }) {
  return (
    <div className="group relative my-5">
      <pre className="overflow-x-auto rounded-xl border border-border bg-card p-4 pr-12 font-mono text-[13px] leading-relaxed [scrollbar-width:thin]">
        {children}
      </pre>
      {code === '' ? null : (
        <CopyButton text={code} className={cn('absolute right-2.5 top-2.5', REVEAL_ON_HOVER)} />
      )}
    </div>
  )
}

/**
 * Resolve a relative URL, then sanitise the result.
 *
 * Order matters: resolving first means `defaultUrlTransform` judges the URL the
 * browser will actually request. A leading slash is treated as repository-root
 * relative, matching how the source host reads its own readme — resolving it
 * against the origin instead would send every `/docs/x.png` to the host's front
 * page.
 */
function urlTransform(docBase?: string, assetBase?: string): UrlTransform {
  return (url, key) => {
    const base = key === 'src' ? assetBase : docBase
    if (base === undefined || url === '' || url.startsWith('#')) {
      return defaultUrlTransform(url)
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) {
      return defaultUrlTransform(url)
    }
    try {
      return defaultUrlTransform(new URL(url.replace(/^\/+/, ''), base).toString())
    } catch {
      return ''
    }
  }
}

function isLinkable(href: string | undefined): href is string {
  return href !== undefined && /^(https?:|mailto:|#)/i.test(href)
}

/** The text a node renders to, which is what a code fence and a slug both need. */
function nodeText(node: Node | { type: string; value?: string; children?: unknown[] }): string {
  if ('value' in node && typeof node.value === 'string') return node.value
  const children = 'children' in node ? node.children : undefined
  if (!Array.isArray(children)) return ''
  return children.map((child) => nodeText(child as Node)).join('')
}

/** GitHub's heading-id shape, so a readme's own anchor links resolve. */
function slug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}
