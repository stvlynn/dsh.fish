import { renderToReadableStream } from 'react-dom/server'
import { ServerRouter } from 'react-router'
import type { EntryContext } from 'react-router'
import { isbot } from 'isbot'

export { hubContext } from '@/shared/api/hub-context'
export const streamTimeout = 10_000

export default async function handleDocument(
  request: Request,
  status: number,
  headers: Headers,
  context: EntryContext,
) {
  const stream = await renderToReadableStream(
    <ServerRouter context={context} url={request.url} />,
    {
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(streamTimeout)]),
      onError() {
        status = 500
        console.error(JSON.stringify({ event: 'ssr_render_failed' }))
      },
    },
  )
  if (isbot(request.headers.get('user-agent') ?? '') || context.isSpaMode) await stream.allReady
  headers.set('content-type', 'text/html; charset=utf-8')
  return new Response(request.method === 'HEAD' ? null : stream, {
    status,
    headers,
  })
}
