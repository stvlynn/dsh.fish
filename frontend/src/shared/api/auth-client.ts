import { createAuthClient } from 'better-auth/react'
import { deviceAuthorizationClient } from 'better-auth/client/plugins'

/**
 * Browser half of Better Auth. Same origin as the API, so it needs no baseURL
 * and the session cookie travels without CORS configuration.
 */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  plugins: [deviceAuthorizationClient()],
})

export const { signIn, signOut, useSession } = authClient
