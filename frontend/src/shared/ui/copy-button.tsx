import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, Copy } from 'lucide-react'
import { t } from '@/shared/config/messages'
import { cn } from '@/shared/lib/utils'

/** How long the check stays before the button offers to copy again. */
const CONFIRM_MS = 1600

/**
 * Reveal-on-hover for a copy button that sits on top of the content it copies.
 *
 * Hiding it until hover keeps a code block clean, but a touch device has no
 * hover to give — an unconditional `opacity-0` leaves the control permanently
 * invisible on every phone and tablet. So the hidden state is scoped to
 * pointers that can hover, and a touch device simply gets the button. Keyboard
 * users get it back on focus, so tabbing never lands on something unseeable.
 */
export const REVEAL_ON_HOVER =
  'opacity-100 transition-opacity [@media(hover:hover)and(pointer:fine)]:opacity-0 focus-visible:opacity-100 group-hover:opacity-100'

/**
 * Copy-to-clipboard affordance for a block of text.
 *
 * The icon swap is the whole interaction, so it gets the full treatment:
 * opacity, scale and blur together, on a spring with no bounce. Toggling
 * `visibility` instead would make the button blink between two unrelated
 * glyphs; blurring across the swap reads as one mark changing rather than two
 * marks trading places.
 *
 * A failed clipboard write — an insecure origin, a denied permission — leaves
 * the button in its idle state. That is the honest report: nothing was copied,
 * so nothing claims it was.
 */
export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      return
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), CONFIRM_MS)
  }

  return (
    <button
      type="button"
      aria-label={t(copied ? 'common.copied' : 'common.copy')}
      onClick={() => void copy()}
      className={cn(
        'press hit-area grid size-7 place-items-center rounded-md border border-border bg-card',
        className,
      )}
    >
      {/* initial={false} so the copy icon does not animate in on first paint. */}
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={copied ? 'copied' : 'idle'}
          initial={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.25, filter: 'blur(4px)' }}
          transition={{ type: 'spring', duration: 0.3, bounce: 0 }}
          className="grid place-items-center"
        >
          {copied ? (
            <Check className="size-3.5 text-primary" aria-hidden />
          ) : (
            <Copy className="size-3.5" aria-hidden />
          )}
        </motion.span>
      </AnimatePresence>
    </button>
  )
}
