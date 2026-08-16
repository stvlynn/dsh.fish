import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ShieldCheck, Terminal } from 'lucide-react'
import { EASE_OUT } from '@/shared/lib/ease'
import type { Route } from './+types/device-page'
import { OTPInput, type OTPStatus } from '@/shared/ui/motion/otp-input'
import { authClient, useSession } from '@/shared/api/auth-client'
import { t } from '@/shared/config/messages'

/** Kept in step with `DEVICE_USER_CODE_LENGTH` on the auth configuration. */
const CODE_LENGTH = 8

export function meta(): Route.MetaDescriptors {
  return [
    { title: `${t('device.title')} — ${t('app.name')}` },
    // Nothing about an in-flight authorization belongs in a search index.
    { name: 'robots', content: 'noindex' },
  ]
}

type Phase = 'entering' | 'confirming' | 'approved' | 'denied'

/**
 * The human half of the OAuth device grant.
 *
 * A harness on a developer's machine cannot receive an OAuth redirect, so the
 * plugin asks for a short code, prints it, and polls. This page is where the
 * person — already signed in, in a browser they trust — turns that code into a
 * token. `verification_uri_complete` links straight here with the code
 * prefilled, so the common path is one click and one confirmation.
 */
export default function DevicePage() {
  const [params] = useSearchParams()
  const { data: session, isPending } = useSession()

  const [code, setCode] = useState(() => (params.get('user_code') ?? '').replace(/\D/g, ''))
  const [phase, setPhase] = useState<Phase>('entering')
  const [status, setStatus] = useState<OTPStatus>('idle')
  const [busy, setBusy] = useState(false)

  // Better Auth binds the pending code to this session on GET /device. Approve
  // and deny refuse an unclaimed code, so a complete code — typed or prefilled
  // — has to be claimed before the confirmation step is shown.
  useEffect(() => {
    if (!session?.user || code.length !== CODE_LENGTH || phase !== 'entering') return
    let cancelled = false
    setBusy(true)
    void authClient
      .device({ query: { user_code: code } })
      .then((result) => {
        if (cancelled) return
        if (result.error) {
          setStatus('error')
          return
        }
        setStatus('idle')
        setPhase('confirming')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })
    return () => {
      cancelled = true
    }
  }, [session?.user, code, phase])

  if (isPending) {
    return <Shell>{t('common.loading')}</Shell>
  }

  if (!session?.user) {
    return (
      <Shell>
        <p className="text-muted-foreground">{t('device.signInFirst')}</p>
        <Link
          to={`/sign-in?redirect=${encodeURIComponent(`/device?user_code=${code}`)}`}
          className="press mt-5 inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground"
        >
          {t('nav.signIn')}
        </Link>
      </Shell>
    )
  }

  if (phase === 'approved') {
    return (
      <Shell icon={<ShieldCheck className="size-6 text-primary" aria-hidden />}>
        <p className="text-lg font-medium">{t('device.approved')}</p>
      </Shell>
    )
  }

  if (phase === 'denied') {
    return (
      <Shell>
        <p className="text-lg font-medium">{t('device.denied')}</p>
      </Shell>
    )
  }

  const decide = async (approve: boolean) => {
    setBusy(true)
    try {
      const result = approve
        ? await authClient.device.approve({ userCode: code })
        : await authClient.device.deny({ userCode: code })

      if (result.error) {
        setStatus('error')
        setPhase('entering')
        return
      }
      setStatus('success')
      setPhase(approve ? 'approved' : 'denied')
    } catch {
      setStatus('error')
      setPhase('entering')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell icon={<Terminal className="size-6 text-primary" aria-hidden />}>
      <p className="text-muted-foreground">{t('device.subtitle')}</p>

      <div className="mt-8 flex justify-center">
        <OTPInput
          length={CODE_LENGTH}
          label={t('device.codeLabel')}
          value={code}
          status={status}
          errorMessage={t('device.invalid')}
          autoFocus={code.length === 0}
          onChange={(value) => {
            setCode(value)
            if (status !== 'idle') setStatus('idle')
            if (value.length < CODE_LENGTH) setPhase('entering')
          }}
        />
      </div>

      {/* The consent step is the one moment that matters here: it appears once,
          after the user has typed a code, and asks them to grant access. A hard
          cut reads as a page glitch; a short rise reads as an answer. */}
      <PhaseReveal show={phase === 'confirming'}>
          <p className="mx-auto mt-8 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {t('device.grantExplain')}
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(false)}
              className="press rounded-lg border border-border px-5 py-2.5 text-sm font-medium hover:border-border-strong disabled:opacity-50"
            >
              {t('device.deny')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void decide(true)}
              className="press rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {t('device.approve')}
            </button>
          </div>
      </PhaseReveal>
    </Shell>
  )
}

/**
 * Enter-only reveal for the consent step.
 *
 * Rare and high-consequence, so it earns motion the rest of this site does not.
 * Reduced motion keeps the fade and drops the travel — gentler, not absent.
 */
function PhaseReveal({ show, children }: { show: boolean; children: React.ReactNode }) {
  const reduce = useReducedMotion()
  return (
    <AnimatePresence initial={false}>
      {show ? (
        <motion.div
          initial={{ opacity: 0, y: reduce ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function Shell({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 text-center">
      {icon ? (
        <div className="mb-4 grid size-12 place-items-center rounded-xl border border-border bg-card">
          {icon}
        </div>
      ) : null}
      <h1 className="text-2xl font-semibold tracking-tight">{t('device.title')}</h1>
      <div className="mt-3 w-full">{children}</div>
    </div>
  )
}
