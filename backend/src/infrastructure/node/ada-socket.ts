import type { AdaSocket, OpenAdaSocket } from '../ada/ada-client.js'

/** Native Node WebSocket; Workers use fetch Upgrade instead. */
export const openNodeAdaSocket: OpenAdaSocket = (url) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url.replace(/^https:/, 'wss:'))
    const timer = setTimeout(() => failed(), 10_000)
    const failed = () => {
      clearTimeout(timer)
      socket.close()
      reject(new Error('Ada WebSocket connection failed.'))
    }
    socket.addEventListener('error', failed, { once: true })
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timer)
        socket.removeEventListener('error', failed)
        resolve(socket as unknown as AdaSocket)
      },
      { once: true },
    )
  })
