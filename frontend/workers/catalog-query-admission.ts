import { splitLocalePath } from "@/shared/config/i18n";

const ADMISSION_OBJECT_NAME = "catalog-expensive-query-global-v1";
const ADMISSION_ORIGIN = "https://catalog-query-admission.internal";
const UNAVAILABLE_RETRY_SECONDS = "120";
const TOKEN_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CatalogQueryAdmissionEnv {
  readonly STORAGE_BACKEND?: "d1" | "mysql";
  readonly CAT_QUERY_ADMISSION?: DurableObjectNamespace;
}

export function isExpensiveCatalogRequest(request: Request): boolean {
  if (request.method !== "GET" && request.method !== "HEAD") return false;
  const url = new URL(request.url);
  const { path } = splitLocalePath(url.pathname.replace(/\.(?:data|md)$/, ""));
  // Facet landing pages apply their path filter even without a query string.
  if (/^\/(?:kind|category|for|topic)\/[^/]+\/?$/.test(path)) return true;
  if (!/^\/(?:browse|artifacts|api\/v1\/artifacts)\/?$/.test(path))
    return false;
  return ["q", "category", "topic", "kind", "verified"].some((key) =>
    url.searchParams.getAll(key).some((value) => value.trim() !== ""),
  );
}

/** Call on cache misses, before opening persistence. next must await all DB work. */
export async function withCatalogQueryAdmission(
  request: Request,
  env: CatalogQueryAdmissionEnv,
  next: () => Promise<Response>,
): Promise<Response> {
  if (env.STORAGE_BACKEND !== "mysql" || !isExpensiveCatalogRequest(request))
    return next();
  const requestId = request.headers.get("cf-ray") ?? crypto.randomUUID();
  const logFailure = (phase: string, status?: number) => {
    // Never include queries, lease tokens, upstream bodies, or raw exception text.
    console.error(
      JSON.stringify({
        event: "catalog_query_admission_failed",
        requestId,
        phase,
        ...(status === undefined ? {} : { status }),
      }),
    );
  };
  if (env.CAT_QUERY_ADMISSION === undefined) {
    logFailure("missing_binding");
    return unavailableResponse();
  }

  let stub: DurableObjectStub;
  let token: string;
  try {
    stub = env.CAT_QUERY_ADMISSION.get(
      env.CAT_QUERY_ADMISSION.idFromName(ADMISSION_OBJECT_NAME),
    );
    const acquired = await stub.fetch(ADMISSION_ORIGIN + "/acquire", {
      method: "POST",
    });
    if (acquired.status === 429) {
      const retryAfter = acquired.headers.get("retry-after");
      await acquired.body?.cancel();
      return new Response(null, {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after":
            retryAfter !== null &&
            /^\d+$/.test(retryAfter) &&
            Number(retryAfter) > 0
              ? retryAfter
              : UNAVAILABLE_RETRY_SECONDS,
        },
      });
    }
    if (acquired.status !== 200) {
      logFailure("acquire_status", acquired.status);
      await acquired.body?.cancel();
      return unavailableResponse();
    }
    const grant: unknown = await acquired.json();
    if (
      typeof grant !== "object" ||
      grant === null ||
      !("token" in grant) ||
      typeof grant.token !== "string" ||
      !TOKEN_PATTERN.test(grant.token) ||
      !("expiresAt" in grant) ||
      typeof grant.expiresAt !== "number" ||
      !Number.isSafeInteger(grant.expiresAt) ||
      grant.expiresAt <= Date.now()
    ) {
      logFailure("invalid_grant");
      return unavailableResponse();
    }
    token = grant.token;
  } catch {
    logFailure("acquire_transport");
    return unavailableResponse();
  }

  try {
    // Do not race a timer against next: timed-out SQL could still hold an origin
    // connection. Release only once the awaited header-stage handler settles.
    return await next();
  } finally {
    try {
      const released = await stub.fetch(ADMISSION_ORIGIN + "/release", {
        method: "POST",
        headers: { "x-catalog-query-token": token },
      });
      if (released.status !== 204)
        logFailure("release_status", released.status);
      await released.body?.cancel();
    } catch {
      // Report failed cleanup without replacing the original handler error/response.
      // The persisted lease remains held until its conservative recovery expiry.
      logFailure("release_transport");
    }
  }
}

function unavailableResponse(): Response {
  return new Response(null, {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "retry-after": UNAVAILABLE_RETRY_SECONDS,
    },
  });
}
