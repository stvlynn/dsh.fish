import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { ZodError } from 'zod'
import { isDomainError } from '../../domain/shared/error.js'
import type { DomainErrorCode } from '../../domain/shared/error.js'

/**
 * The single error envelope every endpoint returns, per
 * `docs/backend/api-conventions.md`. Clients switch on `error.code`, never on
 * the HTTP status alone.
 */
export interface ApiErrorBody {
  readonly error: {
    readonly code: string
    readonly message: string
    readonly hint: string
    readonly details?: Readonly<Record<string, unknown>>
  }
}

export function hintFor(code: DomainErrorCode | 'INTERNAL'): string {
  switch (code) {
    case 'NOT_FOUND':
      return 'List endpoints with GET /openapi.json. Start at /llms.txt or /docs/developers.'
    case 'INVALID_ARGUMENT':
      return 'Compare the request to the matching operation in GET /openapi.json.'
    case 'UNAUTHENTICATED':
      return 'Sign in with GitHub for a browser session, or complete the device grant for a bearer token. See /docs/developers.'
    case 'FORBIDDEN':
      return 'This action needs a browser session or an admin account. See /docs/developers.'
    case 'CONFLICT':
    case 'ALREADY_EXISTS':
      return 'The resource already exists or the request conflicts with current state. See GET /openapi.json.'
    case 'UNSUPPORTED':
      return 'This operation is not available for this artifact or configuration. See GET /openapi.json and /docs/developers.'
    case 'RATE_LIMITED':
      return 'Wait for the Retry-After header, then retry. See GET /openapi.json.'
    case 'UNAVAILABLE':
      return 'Retry shortly. Check GET /api/health.'
    case 'INTERNAL':
      return 'Retry shortly. If it persists, check GET /api/health or /docs/developers.'
  }
}

const STATUS_BY_CODE: Readonly<Record<DomainErrorCode, ContentfulStatusCode>> = {
  INVALID_ARGUMENT: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  ALREADY_EXISTS: 409,
  UNSUPPORTED: 422,
  RATE_LIMITED: 429,
  UNAVAILABLE: 503,
}

export function toApiError(error: unknown): {
  status: ContentfulStatusCode
  body: ApiErrorBody
} {
  if (isDomainError(error)) {
    return {
      status: STATUS_BY_CODE[error.code],
      body: {
        error: {
          code: error.code,
          message: error.message,
          hint: hintFor(error.code),
          ...(Object.keys(error.details).length === 0 ? {} : { details: error.details }),
        },
      },
    }
  }

  // A body or query that fails schema validation is a client error, not a
  // server one: same envelope, with the field paths as the details.
  if (error instanceof ZodError) {
    return {
      status: 400,
      body: {
        error: {
          code: 'INVALID_ARGUMENT',
          message: 'The request did not match the expected shape.',
          hint: hintFor('INVALID_ARGUMENT'),
          details: { issues: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) },
        },
      },
    }
  }

  // An unexpected failure never leaks its message: it may carry a binding name,
  // a query fragment, or an upstream token.
  return {
    status: 500,
    body: {
      error: {
        code: 'INTERNAL',
        message: 'Unexpected server error.',
        hint: hintFor('INTERNAL'),
      },
    },
  }
}
