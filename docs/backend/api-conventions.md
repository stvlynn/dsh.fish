# API Conventions

This document defines how the backend exposes and formats its API.

## Transport

The default transport is HTTP/REST. If the project uses gRPC, GraphQL, or events, document the deviations here and in [`docs/project/architecture.md`](../project/architecture.md).

## Response envelope

Successful JSON payloads are endpoint-specific (an object, a list, a snapshot).
They are not wrapped in a `success`/`data` envelope.

Failed `/api/*` responses, including unknown paths, use `application/json` and
this error object:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "No API route matches this path.",
    "hint": "List endpoints with GET /openapi.json. Start at /llms.txt or /docs/developers.",
    "details": {}
  }
}
```

`code` is the switch key (`NOT_FOUND`, `INVALID_ARGUMENT`, `UNAUTHENTICATED`,
`FORBIDDEN`, `CONFLICT`, `ALREADY_EXISTS`, `UNSUPPORTED`, `RATE_LIMITED`,
`UNAVAILABLE`, `INTERNAL`). `hint` tells an agent what to try next. `details`
is omitted when empty. The OpenAPI document at `/openapi.json` names this
shape `components.schemas.Error` and `$ref`s it from 4xx and 5xx responses.
Do not advertise `application/problem+json`; the runtime does not send it.

## HTTP status codes

| Code | Use case |
|------|----------|
| 200  | Successful read or update. |
| 201  | Successful creation. |
| 204  | Successful deletion or no-content action. |
| 400  | Validation error or malformed request. |
| 401  | Unauthenticated. |
| 403  | Forbidden. |
| 404  | Resource not found. |
| 409  | Conflict (e.g., duplicate unique value). |
| 422  | Semantic validation error. |
| 429  | Caller exceeded a documented rate budget (`RATE_LIMITED`). |
| 500  | Unexpected server error. |
| 503  | A required upstream is down or the Worker circuit is open (`UNAVAILABLE`). |

## Error codes

- Use machine-readable `code` values in `SCREAMING_SNAKE_CASE`.
- Keep `message` concise and safe for end users.
- Do not include stack traces or internal identifiers in production error responses.

## Versioning

- Prefix routes with `/api/v1/` by default.
- Document breaking changes in [`docs/decisions/`](../decisions/README.md).
- The anonymous read surface is described by an OpenAPI 3.1 document served at
  `/openapi.json` (see [`docs/seo/crawling.md`](../seo/crawling.md)); keep it in
  sync when adding or changing public endpoints.

## Streaming exception

`POST /api/v1/artifacts/:id/ask` is the one anonymous endpoint that does not
use the JSON envelope on success. A started response is `text/event-stream`
(`event: file|delta|cite|done|error` plus JSON `data:`), with
`Cache-Control: no-cache, no-store, no-transform`, `Content-Encoding: none`,
and `X-Ask-Query-Id`. Failures **before** the stream
starts still use the envelope above (400, 404, 422, 429, 503). Ask is omitted
from the catalog snapshot and from edge cache.

See [`adr-0004-artifact-ask-via-ada.md`](../decisions/adr-0004-artifact-ask-via-ada.md).

## Pagination

Catalog listings (`GET /api/v1/artifacts`, the browse/kind/category loaders)
use **offset pagination**. The HTML pages must stay crawlable as real
`?offset=` links, and the Worker already calls the use case in-process, so a
cursor token would not save a D1 hop.

```json
{
  "items": [ ... ],
  "total": 100,
  "limit": 24,
  "offset": 0
}
```

`limit` defaults to 24 and caps at 100. The D1 query pages in SQL against the
stored `popularity` column; it does not load the catalog into the Worker and
slice it there.

Use cursor-based pagination for forward-only scans (ingest shards, README
localization backfill). Those already resume from KV. If another collection
needs offset because callers jump to a page number, match the catalog shape
above (`items`, `total`, `limit`, `offset`) rather than a nested
`pagination` object.

## Idempotency

- Mutating endpoints that may be retried should accept an idempotency key header, e.g., `Idempotency-Key`.
- Document which endpoints are idempotent by default (e.g., `PUT` with full replacement).
