import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isExpensiveCatalogRequest,
  withCatalogQueryAdmission,
} from "./catalog-query-admission";

const request = (path = "/browse?q=search", method = "GET") =>
  new Request("https://dsh.fish" + path, {
    method,
    headers: { "cf-ray": "test-request-id" },
  });
const token = "12345678-1234-4234-8234-123456789abc";
function bindings() {
  const fetch = vi.fn(async (input: string, _init?: RequestInit) =>
    input.endsWith("/acquire")
      ? Response.json({ token, expiresAt: Date.now() + 120_000 })
      : new Response(null, { status: 204 }),
  );
  const id = {} as DurableObjectId;
  const namespace = {
    idFromName: vi.fn(() => id),
    get: vi.fn(() => ({ fetch })),
  };
  return {
    fetch,
    namespace,
    env: {
      STORAGE_BACKEND: "mysql" as const,
      CAT_QUERY_ADMISSION: namespace as unknown as DurableObjectNamespace,
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("expensive public catalog request classification", () => {
  it.each([
    "/browse?q=search",
    "/browse?q=&q=search",
    "/browse?category=git",
    "/browse?topic=git",
    "/browse?kind=skill",
    "/browse?verified=true",
    "/api/v1/artifacts?q=search",
    "/api/v1/artifacts?topic=git",
    "/kind/skill",
    "/category/git",
    "/for/code-review",
    "/topic/git",
    "/zh-CN/browse.data?q=search",
    "/ja/category/git.data",
    "/browse.md?q=search",
    "/zh-CN/for/code-review.md",
    "/browse/?category=git",
  ])("requires admission for %s", (path) => {
    expect(isExpensiveCatalogRequest(request(path))).toBe(true);
    expect(isExpensiveCatalogRequest(request(path, "HEAD"))).toBe(true);
  });
  it.each([
    "/",
    "/zh-CN",
    "/browse",
    "/browse?limit=24&offset=48&sort=recent",
    "/api/v1/artifacts?limit=2",
    "/browse?q=%20%20",
    "/browse?kind=&category=",
    "/api/health?q=search",
    "/api/auth/get-session?q=search",
    "/docs/search?q=search",
    "/ja/docs/search?q=search",
    "/docs?category=git",
    "/blog?q=search",
    "/a/example?q=search",
    "/api/v1/artifacts/example?q=search",
    "/api/v1/facets?q=search",
  ])("excludes %s", (path) =>
    expect(isExpensiveCatalogRequest(request(path))).toBe(false),
  );
  it("excludes writes", () =>
    expect(isExpensiveCatalogRequest(request("/browse?q=search", "POST"))).toBe(
      false,
    ));
});

describe("MySQL catalog admission wrapper", () => {
  it("leaves D1 and ordinary MySQL reads unchanged without a binding", async () => {
    const next = vi.fn(async () => new Response("ok"));
    await withCatalogQueryAdmission(request(), { STORAGE_BACKEND: "d1" }, next);
    await withCatalogQueryAdmission(request(), {}, next);
    await withCatalogQueryAdmission(
      request("/browse?offset=24"),
      { STORAGE_BACKEND: "mysql" },
      next,
    );
    expect(next).toHaveBeenCalledTimes(3);
  });

  it("awaits acquisition and handler DB completion before token-specific release", async () => {
    const { fetch, env, namespace } = bindings();
    const acquired = deferred<Response>();
    fetch.mockReturnValueOnce(acquired.promise);
    const work = deferred<Response>();
    const next = vi.fn(() => work.promise);
    const pending = withCatalogQueryAdmission(request(), env, next);
    expect(next).not.toHaveBeenCalled();
    acquired.resolve(Response.json({ token, expiresAt: Date.now() + 120_000 }));
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    expect(fetch).toHaveBeenCalledOnce();
    const response = new Response("result");
    work.resolve(response);
    expect(await pending).toBe(response);
    expect(namespace.idFromName).toHaveBeenCalledWith(
      "catalog-expensive-query-global-v1",
    );
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringMatching(/\/release$/),
      {
        method: "POST",
        headers: { "x-catalog-query-token": token },
      },
    );
  });

  it("rejects overlapping work immediately and admits a new handler after release", async () => {
    const { fetch, env } = bindings();
    let active: string | undefined;
    fetch.mockImplementation(async (input, init) => {
      if (input.endsWith("/acquire")) {
        if (active !== undefined)
          return new Response(null, {
            status: 429,
            headers: { "retry-after": "120" },
          });
        active = crypto.randomUUID();
        return Response.json({
          token: active,
          expiresAt: Date.now() + 120_000,
        });
      }
      if (new Headers(init?.headers).get("x-catalog-query-token") === active)
        active = undefined;
      return new Response(null, { status: 204 });
    });
    const work = deferred<Response>();
    const firstHandler = vi.fn(() => work.promise);
    const first = withCatalogQueryAdmission(request(), env, firstHandler);
    await vi.waitFor(() => expect(firstHandler).toHaveBeenCalledOnce());
    const rejectedHandler = vi.fn();
    expect(
      (
        await withCatalogQueryAdmission(
          request("/category/git"),
          env,
          rejectedHandler,
        )
      ).status,
    ).toBe(429);
    expect(rejectedHandler).not.toHaveBeenCalled();
    expect(
      fetch.mock.calls.filter(([input]) => input.endsWith("/release")),
    ).toHaveLength(0);
    work.resolve(new Response("first"));
    await first;
    const nextHandler = vi.fn(async () => new Response("next"));
    expect(
      (await withCatalogQueryAdmission(request(), env, nextHandler)).status,
    ).toBe(200);
    expect(nextHandler).toHaveBeenCalledOnce();
  });

  it("does not time out or release a handler whose DB work is still pending", async () => {
    vi.useFakeTimers();
    const { fetch, env } = bindings();
    const work = deferred<Response>();
    const started = deferred<void>();
    const pending = withCatalogQueryAdmission(request(), env, () => {
      started.resolve();
      return work.promise;
    });
    await started.promise;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledOnce();
    const error = new Error("DB work settled with failure");
    const assertion = expect(pending).rejects.toBe(error);
    work.reject(error);
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("releases only after handler failure and preserves the original exception", async () => {
    const { fetch, env } = bindings();
    const error = new Error("SQL failed");
    await expect(
      withCatalogQueryAdmission(request(), env, async () => {
        throw error;
      }),
    ).rejects.toBe(error);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects busy admission without running or releasing a handler", async () => {
    const { fetch, env } = bindings();
    fetch.mockResolvedValueOnce(
      new Response(null, { status: 429, headers: { "retry-after": "17" } }),
    );
    const next = vi.fn();
    const response = await withCatalogQueryAdmission(request(), env, next);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("17");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(next).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("fails closed and logs structured metadata when the binding is missing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const next = vi.fn();
    const response = await withCatalogQueryAdmission(
      request(),
      { STORAGE_BACKEND: "mysql" },
      next,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("retry-after")).toBe("120");
    expect(next).not.toHaveBeenCalled();
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toEqual({
      event: "catalog_query_admission_failed",
      requestId: "test-request-id",
      phase: "missing_binding",
    });
  });

  it.each(["transport", "status", "malformed", "expired"])(
    "fails closed on %s acquisition failures",
    async (failure) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const { fetch, env } = bindings();
      if (failure === "transport")
        fetch.mockRejectedValueOnce(new Error("private credential"));
      if (failure === "status")
        fetch.mockResolvedValueOnce(
          new Response("private body", { status: 500 }),
        );
      if (failure === "malformed")
        fetch.mockResolvedValueOnce(
          Response.json({
            token: "bad-token",
            expiresAt: Date.now() + 120_000,
          }),
        );
      if (failure === "expired")
        fetch.mockResolvedValueOnce(
          Response.json({ token, expiresAt: Date.now() }),
        );
      const next = vi.fn();
      expect(
        (await withCatalogQueryAdmission(request(), env, next)).status,
      ).toBe(503);
      expect(next).not.toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it.each(["transport", "status"])(
    "logs sanitized %s release failure without replacing handler success or error",
    async (failure) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const { fetch, env } = bindings();
      fetch.mockImplementation(async (input) => {
        if (input.endsWith("/acquire"))
          return Response.json({ token, expiresAt: Date.now() + 120_000 });
        if (failure === "transport")
          throw new Error("private password and query");
        return new Response("private token", { status: 500 });
      });
      const response = new Response("ok");
      expect(
        await withCatalogQueryAdmission(request(), env, async () => response),
      ).toBe(response);
      const original = new Error("SQL original");
      await expect(
        withCatalogQueryAdmission(request(), env, async () => {
          throw original;
        }),
      ).rejects.toBe(original);
      expect(log).toHaveBeenCalledTimes(2);
      const output = JSON.stringify(log.mock.calls);
      expect(output).not.toContain(token);
      expect(output).not.toContain("private");
      expect(output).not.toContain("search");
      expect(JSON.parse(log.mock.calls[0]![0] as string).phase).toBe(
        "release_" + failure,
      );
    },
  );
});
