import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { useReducedMotion } from 'motion/react'
import type { ArtifactDetail } from '@/entities/artifact/model/types'
import { AskArtifactPanel, AskSuggestions, type AskRequest } from '@/features/ask-artifact'
import { useT } from '@/shared/config/i18n'
import { EASE_OUT_CSS } from '@/shared/lib/ease'
import { cn } from '@/shared/lib/utils'
import { AskPanelClosedIcon, AskPanelOpenIcon } from '@/shared/ui/icon'
import { IconSwap } from '@/shared/ui/icon-swap'
import { Button } from '@/shared/ui/motion/button'
import { BottomSheet } from '@/shared/ui/motion/bottom-sheet'

const LG_QUERY = '(min-width: 1024px)'

/** Same width OpenTrade's agent column uses — the inner pane stays this wide
 *  while the outer clip animates from zero, so the transcript does not reflow. */
const ASK_PANEL_WIDTH = 380

/**
 * How anything inside the page reaches the thread.
 *
 * The page content is this widget's `children`, so a card sitting in the rail
 * has no other way to open the column and put a question in it. Absent — on a
 * plugin with no ask — every consumer renders nothing, which is why the value
 * is optional rather than a no-op.
 */
const AskChannel = createContext<((question: string) => void) | undefined>(undefined)

/**
 * Ask layout on a plugin page.
 *
 * Desktop matches OpenTrade's agent column: the page is the centre surface,
 * the thread is a sibling that grows from zero width, and there is no overlay.
 * Opening it rounds the page's right edge (the two corners that meet the
 * column) and drops a shadow there. The page stays sharp — no backdrop blur.
 *
 * The toggle sits in the page's own top edge because a collapsed column has
 * no surface to put a control on. Mobile still uses the beUI bottom sheet.
 */
export function ArtifactAsk({
  artifactId,
  ask,
  children,
}: {
  artifactId: string
  ask: ArtifactDetail['ask']
  children: ReactNode
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const desktop = useMinWidthLg()
  const reduce = useReducedMotion()
  const [request, setRequest] = useState<AskRequest | undefined>()
  const nextRequestId = useRef(0)

  const askQuestion = useCallback((question: string) => {
    setOpen(true)
    nextRequestId.current += 1
    setRequest({ id: nextRequestId.current, question })
  }, [])

  useEffect(() => {
    if (!open || !desktop) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, desktop])

  if (!ask.available) return children

  const thread = (
    <AskArtifactPanel
      artifactId={artifactId}
      request={request}
      className="flex min-h-0 flex-1 flex-col"
    />
  )

  return (
    <AskChannel.Provider value={askQuestion}>
      <div className="lg:flex lg:min-h-0" data-ask-layout={desktop ? 'column' : 'sheet'}>
        <div
          className={cn(
            'relative min-w-0 flex-1 bg-background',
            'transition-[border-radius,box-shadow] duration-200',
            desktop && open
              ? 'rounded-r-2xl shadow-[var(--shadow-column)] lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:overflow-y-auto'
              : null,
          )}
          style={{ transitionTimingFunction: EASE_OUT_CSS }}
        >
          {desktop && open ? null : (
            <AskTopBar open={open} onToggle={() => setOpen((current) => !current)} />
          )}
          {children}
        </div>

        <AskColumn
          open={desktop && open}
          onClose={() => setOpen(false)}
          title={t('ask.title')}
          reduceMotion={Boolean(reduce)}
        >
          {desktop ? thread : null}
        </AskColumn>

        <BottomSheet
          open={!desktop && open}
          onOpenChange={setOpen}
          title={t('ask.title')}
          snapPoints={[0.72, 0.94]}
          className="bg-card"
          backdropClassName="bg-background/50"
        >
          {desktop ? null : thread}
        </BottomSheet>
      </div>
    </AskChannel.Provider>
  )
}

/**
 * The "you might ask" card, placed by the page but wired to this widget.
 *
 * It lives here rather than in the page because the questions are only useful
 * next to a thread that can answer them: with no ask on this plugin there is
 * no channel, and the card does not render at all.
 */
export function ArtifactAskSuggestions({
  artifactId,
  className,
}: {
  artifactId: string
  className?: string
}) {
  const askQuestion = useContext(AskChannel)
  if (askQuestion === undefined) return null
  return <AskSuggestions seed={artifactId} onAsk={askQuestion} className={className} />
}

function AskTopBar({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const t = useT()
  const label = open ? t('ask.collapse') : t('ask.open')

  return (
    // A real row, pulled back with negative margin, so the control has a
    // hit box Playwright can see. `h-0` plus overflow left the button
    // clipped after the page scrolled to the reviews rail.
    <div className="sticky top-16 z-10 -mb-11 flex justify-end px-3 pt-3 sm:px-6">
      <Button
        type="button"
        variant={open ? 'secondary' : 'ghost'}
        size="icon"
        aria-expanded={open}
        aria-controls="ask-panel"
        aria-label={label}
        onClick={onToggle}
      >
        <IconSwap swapKey={open ? 'open' : 'closed'}>
          {open ? (
            <AskPanelOpenIcon className="size-4" weight="bold" />
          ) : (
            <AskPanelClosedIcon className="size-4" weight="bold" />
          )}
        </IconSwap>
      </Button>
    </div>
  )
}

function AskColumn({
  open,
  onClose,
  title,
  reduceMotion,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  reduceMotion: boolean
  children: ReactNode
}) {
  const t = useT()

  return (
    <aside
      id="ask-panel"
      aria-hidden={!open}
      aria-label={title}
      className={cn(
        'hidden shrink-0 overflow-hidden lg:block',
        'lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)]',
      )}
      style={
        {
          width: open ? ASK_PANEL_WIDTH : 0,
          transition: reduceMotion ? 'none' : `width 200ms ${EASE_OUT_CSS}`,
        } as CSSProperties
      }
    >
      <div
        className={cn(
          'flex h-full flex-col',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
        style={{
          width: ASK_PANEL_WIDTH,
          transition: reduceMotion ? 'none' : `opacity 150ms ${EASE_OUT_CSS}`,
        }}
        inert={!open}
      >
        <header className="flex h-12 shrink-0 items-center gap-1 px-3 ps-4">
          <h2 className="me-auto text-sm font-semibold tracking-tight">{title}</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={t('ask.collapse')}
            onClick={onClose}
          >
            <AskPanelOpenIcon className="size-4" weight="bold" />
          </Button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">{children}</div>
      </div>
    </aside>
  )
}

function useMinWidthLg(): boolean {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(LG_QUERY)
    const sync = () => setMatches(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])

  return matches
}
