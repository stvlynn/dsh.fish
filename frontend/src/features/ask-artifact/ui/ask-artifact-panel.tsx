import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AgentActivity } from '@/shared/ui/agents/agent-activity'
import type { AgentActivityItem } from '@/shared/ui/agents/agent-activity/types'
import { Citations, type CitationItem } from '@/shared/ui/agents/citations'
import { Message, MessageContent, MessageGroup } from '@/shared/ui/agents/message'
import { MessageScroller } from '@/shared/ui/agents/message-scroller'
import { PromptInput } from '@/shared/ui/agents/prompt-input'
import { StreamingResponse } from '@/shared/ui/agents/streaming-response'
import { AgentProgress, ReasoningText } from '@/shared/ui/agents/loading-states'
import { Loader } from '@/shared/ui/motion/loader'
import { Markdown } from '@/shared/ui/markdown'
import { useT } from '@/shared/config/i18n'
import { useDisplayClock } from '@/shared/lib/hooks/use-display-clock'
import { AskHttpError, startAskStream } from '../api/ask-stream'
import {
  applyAskEvent,
  deepWikiSearchUrl,
  emptyAskSession,
  githubBlobUrl,
  startTurn,
  type AskSession,
  type AskTurn,
} from '../model/ask-session'

/**
 * A question handed to the thread from outside it — today, a suggested opener.
 *
 * The counter is what distinguishes "asked again" from a re-render, so the same
 * text can be sent twice without the panel treating the second click as noise.
 */
export type AskRequest = { id: number; question: string }

/**
 * The ask conversation: composer, streamed answer, scanned paths, cites.
 * `queryId` stays in this tab so a follow-up reuses Ada's thread.
 */
export function AskArtifactPanel({
  artifactId,
  className,
  request,
}: {
  artifactId: string
  className?: string
  request?: AskRequest
}) {
  const t = useT()
  const idPrefix = useId()
  const [session, setSession] = useState<AskSession>(emptyAskSession)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [banner, setBanner] = useState<string | undefined>()
  const handledRequest = useRef(0)

  const send = useCallback(
    async (question: string) => {
      const trimmed = question.trim()
      if (trimmed === '' || busy) return
      const turnId = `${idPrefix}-${session.turns.length}`
      setBanner(undefined)
      setBusy(true)
      setDraft('')
      setSession((current) => startTurn(current, trimmed, turnId))
      try {
        const { queryId, events } = await startAskStream({
          artifactId,
          question: trimmed,
          ...(session.queryId === undefined ? {} : { queryId: session.queryId }),
        })
        for await (const event of events) {
          setSession((current) => applyAskEvent(current, event, queryId))
        }
      } catch (error) {
        const copy =
          error instanceof AskHttpError && error.code === 'RATE_LIMITED'
            ? t('ask.rateLimited')
            : error instanceof AskHttpError && (error.code === 'UNAVAILABLE' || error.status === 503)
              ? t('ask.unavailable')
              : t('ask.error')
        setBanner(copy)
        setDraft(trimmed)
        setSession((current) =>
          applyAskEvent(current, { type: 'error', message: copy }, current.queryId),
        )
      } finally {
        setBusy(false)
      }
    },
    [artifactId, busy, idPrefix, session.queryId, session.turns.length, t],
  )

  useEffect(() => {
    if (request === undefined || request.id === handledRequest.current) return
    handledRequest.current = request.id
    // A stream in flight owns the thread, so the question lands in the composer
    // instead: the reader can see it, edit it, and send it when the turn ends.
    if (busy) setDraft(request.question)
    else void send(request.question)
  }, [busy, request, send])

  return (
    <div className={className}>
      <MessageScroller className="min-h-0 flex-1 px-1" label={t('ask.title')}>
        <MessageGroup spacing="default">
          {session.turns.map((turn) => (
            <AskTurnView key={turn.id} turn={turn} queryId={session.queryId} idPrefix={turn.id} />
          ))}
        </MessageGroup>
      </MessageScroller>
      {banner ? (
        <p className="px-1 py-2 text-sm text-destructive" role="alert">
          {banner}
        </p>
      ) : null}
      <PromptInput
        value={draft}
        onValueChange={setDraft}
        onSubmit={(value) => void send(value)}
        loading={busy}
        disabled={false}
        submitLabel={t('ask.send')}
        stopLabel={t('ask.stop')}
        placeholder={t('ask.placeholder')}
        aria-label={t('ask.placeholder')}
        minRows={2}
        maxRows={6}
        className="mt-3"
      />
    </div>
  )
}

function AskTurnView({
  turn,
  queryId,
  idPrefix,
}: {
  turn: AskTurn
  queryId?: string
  idPrefix: string
}) {
  const t = useT()
  const displayed = useDisplayClock(turn.answer, {
    flush: turn.status !== 'streaming',
    resetKey: turn.id,
  })
  const activity: AgentActivityItem[] = turn.files.map((file, index) => ({
    id: `${turn.id}-file-${index}`,
    type: 'tool',
    action: 'read',
    target: t('ask.scanning', { path: file.path }),
  }))
  const fileCitations: CitationItem[] = turn.cites.map((cite, index) => ({
    id: `${turn.id}-cite-${index}`,
    title: cite.path,
    domain: cite.repo,
    url: githubBlobUrl(cite),
  }))
  const deepWikiCitation: CitationItem[] =
    turn.status === 'complete' && queryId !== undefined
      ? [
          {
            id: `${turn.id}-deepwiki`,
            title: t('ask.deepwiki'),
            domain: 'deepwiki.com',
            url: deepWikiSearchUrl(queryId),
          },
        ]
      : []
  const citations = [...deepWikiCitation, ...fileCitations]

  return (
    <>
      <Message from="user" animateIn>
        <MessageContent>
          <p className="rounded-2xl bg-muted px-3 py-2 text-sm text-foreground">{turn.question}</p>
        </MessageContent>
      </Message>
      <Message from="assistant" animateIn>
        <MessageContent>
          {activity.length > 0 ? (
            <AgentActivity
              items={activity}
              status={turn.status === 'streaming' ? 'working' : 'complete'}
              defaultOpen
              collapseOnComplete={false}
              renderWorkingStatus={() => (
                <AgentProgress label={t('ask.working')} running={turn.status === 'streaming'} />
              )}
              className="mb-2"
            />
          ) : turn.status === 'streaming' && displayed === '' ? (
            <ReasoningText
              phrases={[
                t('ask.reasoning.thinking'),
                t('ask.reasoning.context'),
                t('ask.reasoning.connecting'),
                t('ask.reasoning.forming'),
              ]}
              indicator={
                <Loader variant="ascii-line" size={14} speed={0.8} label={t('ask.thinking')} />
              }
            />
          ) : null}
          {displayed !== '' || turn.status !== 'streaming' ? (
            <StreamingResponse
              status={turn.status === 'error' ? 'error' : turn.status}
              copyText={turn.answer}
              sources={citations}
              showActions={false}
            >
              {displayed === '' ? (
                <p className="text-sm text-muted-foreground">
                  {turn.status === 'error' ? (turn.error ?? t('ask.error')) : t('ask.complete')}
                </p>
              ) : (
                <Markdown source={displayed} />
              )}
            </StreamingResponse>
          ) : null}
          {citations.length > 0 && turn.status !== 'streaming' ? (
            <Citations
              citations={citations}
              title={t('ask.sources')}
              idPrefix={idPrefix}
              defaultOpen
              className="mt-2"
            />
          ) : null}
        </MessageContent>
      </Message>
    </>
  )
}
