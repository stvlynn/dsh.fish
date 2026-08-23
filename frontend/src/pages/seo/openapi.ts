import type { Route } from './+types/openapi'
import { hubContext } from '@/shared/api/hub-context'
import { LOCALE_CODES } from '@/shared/config/i18n'

/**
 * `/openapi.json` — the OpenAPI description of the public JSON API.
 *
 * Covers the anonymous read surface only: catalog search, artifact detail,
 * install-plan resolution, facets, the scoring model, and the versioned
 * snapshot. Submissions, admin and auth are reachable by the same router but
 * are not part of the machine-consumable contract, so they are not listed
 * here. The api-catalog document at `/.well-known/api-catalog` points agents
 * at this URL (`rel="service-desc"`), and every HTML page repeats that pointer
 * in a `Link` header.
 */
export function loader({ context }: Route.LoaderArgs) {
  const { baseUrl } = context.get(hubContext).container.config

  return new Response(JSON.stringify(openApiDocument(baseUrl), null, 2), {
    headers: {
      'content-type': 'application/vnd.oai.openapi+json; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  })
}
const ARTIFACT_KINDS = ['bundle', 'profile', 'skill', 'mcp-server', 'agent-preset', 'hook-bridge']

const artifactSummarySchema = {
  type: 'object',
  required: [
    'id',
    'kind',
    'displayName',
    'summary',
    'keywords',
    'categories',
    'topics',
    'sourceOrigin',
    'sourceUrl',
    'verified',
    'deprecated',
    'stats',
    'score',
    'grade',
    'maintenanceStatus',
    'starVelocity7d',
    'starVelocity30d',
    'updatedAt',
  ],
  properties: {
    id: { type: 'string', description: 'Stable artifact slug, usable in /a/:id and /api/v1/artifacts/:id.' },
    kind: { type: 'string', enum: ARTIFACT_KINDS },
    displayName: { type: 'string' },
    summary: { type: 'string' },
    keywords: { type: 'array', items: { type: 'string' } },
    categories: { type: 'array', items: { type: 'string' } },
    topics: { type: 'array', items: { type: 'string' } },
    sourceOrigin: { type: 'string', description: 'Where the indexer read it from: github, npm, awesome-list, or community.' },
    sourceUrl: { type: 'string', format: 'uri' },
    author: {
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' }, url: { type: 'string', format: 'uri' } },
    },
    license: { type: 'string' },
    verified: { type: 'boolean' },
    deprecated: { type: 'boolean' },
    stats: {
      type: 'object',
      required: ['stars', 'downloads', 'installs'],
      properties: {
        stars: { type: 'integer' },
        downloads: { type: 'integer' },
        installs: { type: 'integer', description: 'Installs recorded through resolveInstallPlan(record=true).' },
      },
    },
    score: { type: 'integer', minimum: 0, maximum: 100, description: 'Public quality score; reproducible from GET /api/v1/scoring.' },
    grade: { type: 'string', enum: ['S', 'A', 'B', 'C'] },
    maintenanceStatus: { type: 'string', enum: ['active', 'slowing', 'stale', 'abandoned'] },
    starVelocity7d: { type: 'integer', description: 'Stars gained over the trailing 7 days.' },
    starVelocity30d: { type: 'integer', description: 'Stars gained over the trailing 30 days.' },
    updatedAt: { type: 'string', format: 'date-time' },
    ogImageUrl: { type: 'string', format: 'uri' },
  },
} as const

const errorSchema = {
  $ref: '#/components/schemas/Error',
} as const

const errorComponentSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message', 'hint'],
      properties: {
        code: {
          type: 'string',
          description: 'Machine-readable error code; switch on this, not the HTTP status.',
        },
        message: { type: 'string' },
        hint: {
          type: 'string',
          description:
            'How to recover: a next request, a docs URL, or a header to wait on.',
        },
        details: { type: 'object', additionalProperties: true },
      },
    },
  },
} as const

const artifactReviewsSchema = {
  type: 'object',
  required: ['artifactId', 'scale', 'summary', 'items'],
  properties: {
    artifactId: { type: 'string' },
    scale: {
      type: 'object',
      required: ['min', 'max'],
      description: "The site's own rating system: whole stars from min to max.",
      properties: {
        min: { type: 'integer', enum: [1] },
        max: { type: 'integer', enum: [5] },
      },
    },
    summary: {
      type: 'object',
      required: ['average', 'count', 'distribution'],
      properties: {
        average: { type: ['number', 'null'], description: 'One-decimal mean; null while nobody has rated.' },
        count: { type: 'integer' },
        distribution: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 5,
          maxItems: 5,
          description: 'Count per star value: index 0 is the 1-star count, index 4 the 5-star count.',
        },
      },
    },
    items: {
      type: 'array',
      description: 'Most recently written first. A review may be rating-only, without a comment.',
      items: {
        type: 'object',
        required: ['author', 'rating', 'createdAt', 'updatedAt'],
        properties: {
          author: {
            type: 'object',
            required: ['name'],
            properties: {
              name: { type: 'string' },
              avatarUrl: { type: 'string', format: 'uri' },
            },
          },
          rating: { type: 'integer', minimum: 1, maximum: 5 },
          comment: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
} as const

function jsonResponse(description: string, schema: unknown) {
  return {
    description,
    content: { 'application/json': { schema } },
  }
}

const internalError = jsonResponse('Unexpected server error.', errorSchema)

export function openApiDocument(baseUrl: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'dsh.fish catalog API',
      version: '1.0.0',
      description:
        'Read-only access to the dsh plugin registry: search, artifact detail, install plans, facets, the public scoring model, a versioned whole-catalog snapshot, and (when enabled) a streaming ask against GitHub-sourced artifacts. All endpoints listed here are anonymous. Agents can also request any HTML page as markdown via `Accept: text/markdown`. Ask is omitted from the snapshot contract and is never cached: it is a POST that streams `text/event-stream`.',
    },
    servers: [{ url: baseUrl }],
    components: {
      schemas: {
        Error: errorComponentSchema,
      },
    },
    paths: {
      '/api/health': {
        get: {
          operationId: 'healthCheck',
          summary: 'Liveness probe',
          responses: {
            '200': jsonResponse('The API is up.', {
              type: 'object',
              required: ['status'],
              properties: { status: { type: 'string', enum: ['ok'] } },
            }),
            '500': internalError,
          },
        },
      },
      '/api/v1/artifacts': {
        get: {
          operationId: 'searchArtifacts',
          summary: 'Search the catalog',
          parameters: [
            { name: 'q', in: 'query', schema: { type: 'string', maxLength: 200 }, description: 'Free-text query.' },
            {
              name: 'kind',
              in: 'query',
              schema: { type: 'array', items: { type: 'string', enum: ARTIFACT_KINDS } },
              style: 'form',
              explode: true,
              description: 'Repeatable kind filter.',
            },
            {
              name: 'category',
              in: 'query',
              schema: { type: 'array', items: { type: 'string' } },
              style: 'form',
              explode: true,
              description: 'Repeatable category filter.',
            },
            {
              name: 'topic',
              in: 'query',
              schema: {
                type: 'array',
                items: {
                  type: 'string',
                  enum: ['memory', 'code-review', 'web-search', 'vision-ocr', 'multi-agent', 'ui-themes'],
                },
              },
              style: 'form',
              explode: true,
              description: 'Repeatable user-intent topic filter.',
            },
            {
              name: 'sort',
              in: 'query',
              schema: { type: 'string', enum: ['relevance', 'popular', 'recent', 'name', 'rising'] },
              description: '`rising` ranks by star velocity and needs about a week of metric history.',
            },
            { name: 'verified', in: 'query', schema: { type: 'boolean' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
            { name: 'offset', in: 'query', schema: { type: 'integer', minimum: 0 } },
          ],
          responses: {
            '200': jsonResponse('A page of matching artifacts.', {
              type: 'object',
              required: ['items', 'total', 'limit', 'offset'],
              properties: {
                items: { type: 'array', items: artifactSummarySchema },
                total: { type: 'integer' },
                limit: { type: 'integer' },
                offset: { type: 'integer' },
              },
            }),
            '400': jsonResponse('Invalid query parameters.', errorSchema),
            '500': internalError,
          },
        },
      },
      '/api/v1/artifacts/{id}': {
        get: {
          operationId: 'getArtifactDetail',
          summary: 'One artifact, with README and provenance',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'locale',
              in: 'query',
              schema: { type: 'string', enum: LOCALE_CODES },
              description: 'Returns a current generated README translation when available.',
            },
          ],
          responses: {
            '200': jsonResponse('The artifact detail.', {
              ...artifactSummarySchema,
              required: [...artifactSummarySchema.required, 'payload', 'publishedAt', 'availableLocales'],
              properties: {
                ...artifactSummarySchema.properties,
                payload: { type: 'object', description: 'Kind-specific installation data.' },
                readmeMarkdown: { type: 'string' },
                readmeLocale: { type: 'string', enum: LOCALE_CODES },
                readmeMachineTranslated: { type: 'boolean' },
                sourceDocBase: { type: 'string', format: 'uri', description: 'What a relative link in readmeMarkdown points at.' },
                sourceAssetBase: { type: 'string', format: 'uri' },
                sourceCommitSha: { type: 'string', description: 'The commit the indexer scanned, for git sources.' },
                sourceCommitUrl: { type: 'string', format: 'uri' },
                publishedAt: { type: 'string', format: 'date-time' },
                availableLocales: { type: 'array', items: { type: 'string', enum: LOCALE_CODES } },
                ask: artifactAskSchema(),
              },
            }),
            '404': jsonResponse('No artifact with that id.', errorSchema),
            '500': internalError,
          },
        },
      },
      '/api/v1/artifacts/{id}/ask': {
        post: {
          operationId: 'askArtifact',
          summary: 'Ask a GitHub-sourced artifact (SSE)',
          description:
            'Anonymous Fast-mode proxy of DeepWiki Ada. Streaming is an exception to the JSON envelope: a started response is `text/event-stream` with events `file`, `delta`, `cite`, `done`, and `error`. Failures before the stream starts still use the JSON error envelope (400, 404, 422, 429, 503). Ask is omitted from the anonymous snapshot contract and from edge cache. GitHub sources only; npm and submissions return 422. Gated by ARTIFACT_ASK_ENABLED.',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['question'],
                  properties: {
                    question: { type: 'string', minLength: 1, maxLength: 2000 },
                    queryId: {
                      type: 'string',
                      description: 'Reuse the previous query id for a follow-up in the same tab.',
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Mapped Ada events as Server-Sent Events. X-Ask-Query-Id is the thread id.',
              headers: {
                'X-Ask-Query-Id': { schema: { type: 'string' } },
                'Cache-Control': { schema: { type: 'string', enum: ['no-cache, no-store, no-transform'] } },
              },
              content: {
                'text/event-stream': {
                  schema: {
                    type: 'string',
                    description: 'SSE frames: event is file|delta|cite|done|error; data is JSON.',
                  },
                },
              },
            },
            '400': jsonResponse('Invalid body.', errorSchema),
            '404': jsonResponse('No artifact with that id.', errorSchema),
            '422': jsonResponse('Ask is disabled or the artifact is not GitHub-sourced.', errorSchema),
            '429': jsonResponse('Caller or artifact budget exhausted (RATE_LIMITED).', errorSchema),
            '503': jsonResponse('Ada or the Worker circuit is unavailable (UNAVAILABLE).', errorSchema),
            '500': internalError,
          },
        },
      },
      '/api/v1/artifacts/{id}/install-plan': {
        get: {
          operationId: 'resolveInstallPlan',
          summary: 'Concrete steps that install the artifact',
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'profile', in: 'query', schema: { type: 'string', maxLength: 64 } },
            {
              name: 'record',
              in: 'query',
              schema: { type: 'boolean' },
              description: 'Only the real installer sets this; it counts the install.',
            },
          ],
          responses: {
            '200': jsonResponse('The resolved install plan.', {
              type: 'object',
              required: ['artifactId', 'kind', 'profile', 'steps', 'manualCommands', 'warningKeys'],
              properties: {
                artifactId: { type: 'string' },
                kind: { type: 'string', enum: ARTIFACT_KINDS },
                profile: { type: 'string' },
                steps: {
                  type: 'array',
                  items: {
                    type: 'object',
                    description: 'One of addPackage, writeFile, patchRow, requireCredential.',
                  },
                },
                manualCommands: { type: 'array', items: { type: 'string' } },
                warningKeys: { type: 'array', items: { type: 'string' } },
                scannedAtCommit: { type: 'string' },
              },
            }),
            '404': jsonResponse('No artifact with that id.', errorSchema),
            '500': internalError,
          },
        },
      },
      '/api/v1/artifacts/{id}/reviews': {
        get: {
          operationId: 'getArtifactReviews',
          summary: 'Community ratings: the scale, the aggregate, and recent reviews',
          description:
            "The site's own 1–5 star rating system. Ratings are written from the dsh harness (the hub plugin's rate tool, or `dsh-fish rate`), never from the web; this endpoint is the anonymous read side the artifact pages are rendered from.",
          parameters: [
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
            {
              name: 'limit',
              in: 'query',
              schema: { type: 'integer', minimum: 1, maximum: 100 },
              description: 'Maximum recent reviews to return (default 20).',
            },
          ],
          responses: {
            '200': jsonResponse('The rating scale, the aggregate, and the most recent reviews.', artifactReviewsSchema),
            '404': jsonResponse('No artifact with that id.', errorSchema),
            '500': internalError,
          },
        },
      },
      '/api/v1/facets': {
        get: {
          operationId: 'listCatalogFacets',
          summary: 'Filter rails: kinds, categories and intent topics with counts',
          responses: {
            '200': jsonResponse('Kinds, categories and topics.', {
              type: 'object',
              required: ['kinds', 'categories', 'topics'],
              properties: {
                kinds: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['kind', 'labelKey', 'descriptionKey', 'packageManaged', 'count'],
                    properties: {
                      kind: { type: 'string', enum: ARTIFACT_KINDS },
                      labelKey: { type: 'string' },
                      descriptionKey: { type: 'string' },
                      packageManaged: { type: 'boolean' },
                      count: { type: 'integer' },
                    },
                  },
                },
                categories: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'labelKey', 'count'],
                    properties: { id: { type: 'string' }, labelKey: { type: 'string' }, count: { type: 'integer' } },
                  },
                },
                topics: {
                  type: 'array',
                  items: {
                    type: 'object',
                    required: ['id', 'labelKey', 'count'],
                    properties: { id: { type: 'string' }, labelKey: { type: 'string' }, count: { type: 'integer' } },
                  },
                },
              },
            }),
            '500': internalError,
          },
        },
      },
      '/api/v1/scoring': {
        get: {
          operationId: 'describeScoring',
          summary: 'The public scoring model as data',
          description:
            'Weights, windows and thresholds behind the score / grade / maintenanceStatus fields, so anyone can recompute what the site shows.',
          responses: {
            '200': jsonResponse('The scoring model.', {
              type: 'object',
              required: ['weights', 'popularity', 'maintenance', 'quality', 'grades'],
              properties: {
                weights: {
                  type: 'object',
                  properties: {
                    popularity: { type: 'number' },
                    maintenance: { type: 'number' },
                    quality: { type: 'number' },
                  },
                },
                popularity: {
                  type: 'object',
                  properties: {
                    raw: { type: 'string' },
                    scale: { type: 'string' },
                    saturation: { type: 'integer' },
                  },
                },
                maintenance: {
                  type: 'object',
                  properties: {
                    windowsDays: { type: 'object', properties: { active: { type: 'integer' }, slowing: { type: 'integer' }, stale: { type: 'integer' } } },
                    dimensionScores: { type: 'object', properties: { active: { type: 'integer' }, slowing: { type: 'integer' }, stale: { type: 'integer' }, abandoned: { type: 'integer' } } },
                  },
                },
                quality: {
                  type: 'object',
                  properties: {
                    points: { type: 'object', properties: { verified: { type: 'integer' }, readme: { type: 'integer' }, license: { type: 'integer' }, author: { type: 'integer' } } },
                  },
                },
                grades: { type: 'object', properties: { S: { type: 'integer' }, A: { type: 'integer' }, B: { type: 'integer' } } },
              },
            }),
            '500': internalError,
          },
        },
      },
      '/api/v1/catalog/version': {
        get: {
          operationId: 'getCatalogVersion',
          summary: 'Cheap poll: has the catalog changed?',
          description:
            'Metadata-only read. A sync client compares dataVersion with the one it holds and skips the snapshot download when nothing changed.',
          responses: {
            '200': jsonResponse('Current catalog metadata.', catalogMetaSchema()),
            '500': internalError,
          },
        },
      },
      '/api/v1/catalog/snapshot': {
        get: {
          operationId: 'getCatalogSnapshot',
          summary: 'The whole public catalog as one document',
          description:
            'The data version doubles as the ETag, so a conditional request with If-None-Match costs a 304 when nothing changed.',
          parameters: [
            { name: 'If-None-Match', in: 'header', schema: { type: 'string' }, description: 'A previously seen ETag.' },
          ],
          responses: {
            '200': {
              description: 'The catalog snapshot.',
              headers: {
                ETag: { schema: { type: 'string' }, description: 'The dataVersion, quoted.' },
              },
              content: {
                'application/json': {
                  schema: {
                    ...catalogMetaSchema(),
                    properties: {
                      ...catalogMetaSchema().properties,
                      artifacts: { type: 'array', items: artifactSummarySchema },
                    },
                  },
                },
              },
            },
            '304': { description: 'Unchanged since the presented ETag.' },
            '500': internalError,
          },
        },
      },
    },
  }
}

function catalogMetaSchema() {
  return {
    type: 'object',
    required: ['dataVersion', 'artifactCount', 'generatedAt'],
    properties: {
      dataVersion: { type: 'string', pattern: '^[0-9a-f]{64}$' },
      artifactCount: { type: 'integer' },
      generatedAt: { type: 'string', format: 'date-time' },
    },
  } as const
}

function artifactAskSchema() {
  return {
    oneOf: [
      {
        type: 'object',
        required: ['available', 'repoName'],
        properties: {
          available: { type: 'boolean', enum: [true] },
          repoName: { type: 'string', description: 'GitHub owner/repo Ada will be asked about.' },
        },
      },
      {
        type: 'object',
        required: ['available', 'reason'],
        properties: {
          available: { type: 'boolean', enum: [false] },
          reason: { type: 'string', enum: ['not_github', 'disabled'] },
        },
      },
    ],
  } as const
}
