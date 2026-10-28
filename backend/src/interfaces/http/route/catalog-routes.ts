import { Hono } from 'hono'
import { z } from 'zod'
import { ARTIFACT_KINDS } from '../../../domain/artifact/artifact-kind.js'
import { TOPIC_IDS } from '../../../domain/artifact/topic.js'
import type { HubBindings } from '../app.js'

const searchQuery = z.object({
  q: z.string().max(200).optional(),
  /** Optional BCP 47 locale for translated summaries. */
  locale: z
    .string()
    .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
    .optional(),
  kind: z.array(z.enum(ARTIFACT_KINDS)).optional(),
  category: z.array(z.string()).optional(),
  topic: z.array(z.enum(TOPIC_IDS)).optional(),
  sort: z.enum(['relevance', 'popular', 'recent', 'name', 'rising']).optional(),
  verified: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

const installQuery = z.object({
  profile: z.string().max(64).optional(),
  /** Only the plugin's real install sets this; the site previews without it. */
  record: z.coerce.boolean().optional(),
})

const detailQuery = z.object({
  /** Optional BCP 47 locale for the generated README projection. */
  locale: z
    .string()
    .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/)
    .optional(),
})

/**
 * Read-only catalog endpoints. Anonymous by design: browsing and resolving an
 * install plan never require an account, so a first-time user can copy a
 * command without signing up.
 */
export function catalogRoutes() {
  const routes = new Hono<HubBindings>()

  routes.get('/artifacts', async (context) => {
    const parsed = searchQuery.parse({
      ...context.req.query(),
      kind: context.req.queries('kind'),
      category: context.req.queries('category'),
      topic: context.req.queries('topic'),
    })
    const result = await context.get('container').useCases.searchArtifacts.execute({
      ...(parsed.q === undefined ? {} : { text: parsed.q }),
      ...(parsed.kind === undefined ? {} : { kinds: parsed.kind }),
      ...(parsed.category === undefined ? {} : { categories: parsed.category }),
      ...(parsed.topic === undefined ? {} : { topics: parsed.topic }),
      ...(parsed.sort === undefined ? {} : { sort: parsed.sort }),
      ...(parsed.verified === undefined ? {} : { verifiedOnly: parsed.verified }),
      ...(parsed.limit === undefined ? {} : { limit: parsed.limit }),
      ...(parsed.offset === undefined ? {} : { offset: parsed.offset }),
      ...(parsed.locale === undefined ? {} : { locale: parsed.locale }),
    })
    return context.json(result)
  })

  routes.get('/artifacts/:id', async (context) => {
    const parsed = detailQuery.parse(context.req.query())
    const detail = await context
      .get('container')
      .useCases.getArtifactDetail.execute(context.req.param('id'), parsed.locale)
    return context.json(detail)
  })

  routes.get('/artifacts/:id/install-plan', async (context) => {
    const parsed = installQuery.parse(context.req.query())
    const plan = await context.get('container').useCases.resolveInstallPlan.execute({
      artifactId: context.req.param('id'),
      ...(parsed.profile === undefined ? {} : { profile: parsed.profile }),
      ...(parsed.record === undefined ? {} : { recordInstall: parsed.record }),
    })
    return context.json(plan)
  })

  routes.get('/facets', async (context) => {
    const facets = await context.get('container').useCases.listCatalogFacets.execute()
    return context.json(facets)
  })

  /**
   * The scoring model as data: weights, windows and thresholds behind the
   * `score` / `grade` / `maintenanceStatus` fields, so the site can document
   * the formula and anyone can reproduce it.
   */
  routes.get('/scoring', async (context) => {
    return context.json(context.get('container').useCases.describeScoring.execute())
  })

  /**
   * Cheap poll for sync clients: has the catalog changed since the version a
   * directory already holds? Metadata-only, so it never reads an artifact row.
   */
  routes.get('/catalog/version', async (context) => {
    const meta = await context.get('container').useCases.getCatalogSnapshot.meta()
    return context.json(meta)
  })

  /**
   * The whole public catalog as one document. The data version doubles as the
   * ETag, so a sync client that polls `/catalog/version` can skip this download
   * entirely when nothing changed, and a conditional request costs a 304.
   */
  routes.get('/catalog/snapshot', async (context) => {
    const snapshot = await context.get('container').useCases.getCatalogSnapshot.snapshot()
    const etag = `"${snapshot.meta.dataVersion}"`
    context.header('ETag', etag)
    context.header('Cache-Control', 'public, max-age=300')
    const held = context.req
      .header('if-none-match')
      ?.split(',')
      .map((value) => value.trim())
    if (held !== undefined && (held.includes(etag) || held.includes('*'))) {
      return context.body(null, 304)
    }
    return context.body(snapshot.body, 200, {
      'Content-Type': 'application/json; charset=utf-8',
    })
  })

  /**
   * The public catalog as a DSH plugin-market index (format 1).
   *
   * This is what a harness adds under Settings -> Plugins -> Discover -> Manage
   * indexes to browse and install dsh.fish artifacts from inside the app. The
   * document is a projection of the same rows `/catalog/snapshot` serves, so
   * the two never disagree; see `buildMarketIndex` for why skills and agent
   * presets are absent (the market format can only express package installs).
   */
  routes.get('/market/index.json', async (context) => {
    const index = await context.get('container').useCases.getMarketIndex.index()
    context.header('Cache-Control', 'public, max-age=300')
    return context.json(index)
  })

  return routes
}
