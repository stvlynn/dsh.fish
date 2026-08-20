import { useState } from 'react'
import { DashboardIcon, SignInIcon, SignOutIcon } from '@/shared/ui/icon'
import { signOut, useSession } from '@/shared/api/auth-client'
import { useT } from '@/shared/config/i18n'
import { LocaleLink } from '@/shared/ui/locale-link'
import { Avatar } from '@/shared/ui/avatar'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/motion/popover'

/**
 * The signed-in identity, and everything that acts on it.
 *
 * GitHub is the only sign-in, so the portrait Better Auth cached from that
 * OAuth profile is what proves, at a glance, which account a page is being
 * read as. It doubles as the trigger for the account actions, which keeps one
 * control in the bar instead of a row of text links.
 */
export function AccountMenu() {
  const t = useT()
  const { data: session, isPending } = useSession()
  const [open, setOpen] = useState(false)
  const user = session?.user

  // The session resolves on the client, so the slot is held at its final size
  // rather than swapping a sign-in link for an avatar a frame later.
  if (isPending) return <span className="size-9 shrink-0 rounded-full bg-muted" />

  if (!user) {
    return (
      <LocaleLink
        to="/sign-in"
        aria-label={t('nav.signIn')}
        className="press inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-2.5 py-1.5 text-sm font-medium text-primary-foreground sm:px-4"
      >
        <SignInIcon className="size-4" weight="bold" />
        {/* Icon-only on a phone, where the bar has no room for the word. */}
        <span className="hidden sm:inline">{t('nav.signIn')}</span>
      </LocaleLink>
    )
  }

  const name = user.name || user.email || ''

  return (
    <Popover open={open} onOpenChange={setOpen} side="bottom" align="end" sideOffset={12}>
      <PopoverTrigger>
        <button
          type="button"
          aria-label={t('account.menu')}
          className="press rounded-full outline-offset-2"
        >
          <Avatar src={user.image} name={name} />
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-60 p-2">
        <div className="flex items-center gap-3 px-2 py-2">
          <Avatar src={user.image} name={name} size="lg" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium">{name}</span>
            {user.email && user.email !== name ? (
              <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
            ) : null}
          </span>
        </div>

        <span className="my-1 block h-px bg-border" />

        <LocaleLink
          to="/dashboard"
          onClick={() => setOpen(false)}
          className="flex items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          <DashboardIcon className="size-4 text-muted-foreground" weight="bold" />
          {t('nav.dashboard')}
        </LocaleLink>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            void signOut()
          }}
          className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-sm font-medium transition-colors hover:bg-muted"
        >
          <SignOutIcon className="size-4 text-muted-foreground" weight="bold" />
          {t('nav.signOut')}
        </button>
      </PopoverContent>
    </Popover>
  )
}
