/**
 * Per-site (TENANT) authentication (Phase 8, Track B — D-020 / D-047 / D-048).
 *
 * Each provisioned site has its own visitor/member auth, multi-tenant by
 * `site_id` under the ONE shared renderer (D-003). A request-scoped Better-auth
 * instance per `site_id` reads/writes ONLY that site's rows in the shared
 * `tenant_auth_*` tables.
 *
 * **Scoping mechanism (D-048):** rather than reimplement a DB adapter, we WRAP
 * Better-auth's own working adapter — `site_id` is declared as an
 * `additionalField` on every model (so the adapter persists + returns it), and
 * a thin wrapper injects `site_id` into the data on `create` and appends
 * `{ field: "site_id", value: siteId }` to the `where` on every read/write.
 * This closes the cross-site leak that `UNIQUE(site_id, email)` would otherwise
 * allow (a findOne-by-email could match another site's user). SEPARATE from the
 * Studio internal-team auth (`auth_*`).
 */
import { betterAuth } from "better-auth";
import type { Pool } from "pg";
import { pool as defaultPool } from "../db.js";

const SITE_FIELD = { type: "string", required: true, input: false } as const;

/** Shared model config: tenant_auth_* tables + a `site_id` field on each. */
function tenantModelConfig() {
  return {
    user: { modelName: "tenant_auth_user", additionalFields: { site_id: SITE_FIELD } },
    session: { modelName: "tenant_auth_session", additionalFields: { site_id: SITE_FIELD } },
    account: { modelName: "tenant_auth_account", additionalFields: { site_id: SITE_FIELD } },
    verification: {
      modelName: "tenant_auth_verification",
      additionalFields: { site_id: SITE_FIELD },
    },
  } as const;
}

/**
 * D812 (W2-SEC) — session-signing secret for tenant auth.
 *
 * STATUS: tenant auth is DORMANT — `getTenantAuth` has zero production
 * consumers today (nothing mounts it; only tests exercise it). This function
 * used to fall back SILENTLY to a hardcoded, repo-public string, which would
 * have signed real visitor sessions with a known key on the day someone
 * finally mounted it without config. Now: reuse the app session secret
 * (BETTER_AUTH_SECRET — same prereq as Studio auth), FAIL LOUDLY in
 * production when it's missing, and keep the dev/test fallback only outside
 * production (local work without secrets stays possible; the string is
 * useless to sign anything real with because prod refuses to use it).
 */
export function tenantSecret(env: NodeJS.ProcessEnv = process.env): string {
  if (env.BETTER_AUTH_SECRET) return env.BETTER_AUTH_SECRET;
  if (env.NODE_ENV === "production") {
    throw new Error(
      "tenant-auth: BETTER_AUTH_SECRET is not set — refusing to construct tenant auth " +
        "with the shared dev fallback secret in production (D812). Tenant auth is dormant; " +
        "provision the secret before mounting it.",
    );
  }
  return "dev-tenant-auth-secret-please-set-in-prod";
}

// Builders are factored out so their (narrowed) return types can be inferred —
// `ReturnType<typeof betterAuth>` widens to `Auth<BetterAuthOptions>`, which the
// concrete instances aren't assignable to (contravariant adapter type, cf. D-046).
function buildBaseAuth(pool: Pool) {
  return betterAuth({
    database: pool,
    secret: tenantSecret(),
    baseURL: "http://tenant.internal",
    emailAndPassword: { enabled: true },
    ...tenantModelConfig(),
  });
}

/** Adapter type = the object Better-auth exposes at `auth.$context.adapter`. */
type TenantAdapter = Awaited<ReturnType<typeof buildBaseAuth>["$context"]>["adapter"];

type WhereItem = { field: string; value: unknown };
type AdapterArgs = { where?: WhereItem[]; data?: Record<string, unknown> };
type AdapterFn = (args: AdapterArgs) => unknown;

// The base adapter (over the shared Pool) is built ONCE; per-site instances
// wrap it. Keyed by pool so tests with an injected pool get their own base.
const baseAdapterByPool = new WeakMap<Pool, Promise<TenantAdapter>>();

function getBaseAdapter(pool: Pool): Promise<TenantAdapter> {
  let p = baseAdapterByPool.get(pool);
  if (!p) {
    p = buildBaseAuth(pool).$context.then((c) => c.adapter);
    baseAdapterByPool.set(pool, p);
  }
  return p;
}

/** Wrap a base adapter so every operation is constrained to one `site_id`. */
export function scopedAdapter(base: TenantAdapter, siteId: string): TenantAdapter {
  const scopeWhere = (where?: WhereItem[]): WhereItem[] => [
    ...(where ?? []),
    { field: "site_id", value: siteId },
  ];
  const b = base as unknown as Record<string, AdapterFn | undefined>;
  const wrapWhere =
    (name: string): AdapterFn =>
    (args) =>
      (b[name] as AdapterFn)({ ...args, where: scopeWhere(args.where) });

  const wrapped: Record<string, unknown> = {
    ...(base as unknown as Record<string, unknown>),
    create: ((args) =>
      (b.create as AdapterFn)({
        ...args,
        data: { ...(args.data ?? {}), site_id: siteId },
      })) as AdapterFn,
    findOne: wrapWhere("findOne"),
    findMany: wrapWhere("findMany"),
    update: wrapWhere("update"),
    updateMany: wrapWhere("updateMany"),
    delete: wrapWhere("delete"),
    deleteMany: wrapWhere("deleteMany"),
    count: wrapWhere("count"),
  };
  if (typeof b.consumeOne === "function") wrapped.consumeOne = wrapWhere("consumeOne");
  if (typeof b.transaction === "function") {
    const txFn = b.transaction as unknown as (f: (tx: TenantAdapter) => unknown) => unknown;
    wrapped.transaction = (fn: (tx: TenantAdapter) => unknown) =>
      txFn((tx) => fn(scopedAdapter(tx, siteId)));
  }
  return wrapped as unknown as TenantAdapter;
}

export type TenantProviders = { emailPassword?: boolean };

function buildScopedAuth(scoped: TenantAdapter, opts: {
  providers?: TenantProviders;
  baseURL?: string;
  env?: NodeJS.ProcessEnv;
}) {
  return betterAuth({
    database: () => scoped,
    secret: tenantSecret(opts.env),
    baseURL: opts.baseURL ?? "http://tenant.internal",
    basePath: "/api/auth",
    emailAndPassword: { enabled: opts.providers?.emailPassword !== false },
    ...tenantModelConfig(),
  });
}

export type TenantAuth = ReturnType<typeof buildScopedAuth>;

const tenantAuthBySite = new Map<string, TenantAuth>();

/**
 * Build (and cache) the Better-auth instance for one site. v1 enables
 * email+password member auth; per-site provider config (`tenant_auth_config`)
 * can toggle it. Per-site social OAuth (needs per-site client IDs) is a future
 * refinement. `opts` is injectable for tests.
 */
export async function getTenantAuth(
  siteId: string,
  opts: { pool?: Pool; providers?: TenantProviders; baseURL?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<TenantAuth> {
  const cached = tenantAuthBySite.get(siteId);
  if (cached) return cached;

  // D812 — resolve the secret FIRST so a misconfigured production deployment
  // fails here, loudly, before any adapter/DB work (and before anything gets
  // cached).
  tenantSecret(opts.env);

  const base = await getBaseAdapter(opts.pool ?? defaultPool);
  const auth = buildScopedAuth(scopedAdapter(base, siteId), opts);
  tenantAuthBySite.set(siteId, auth);
  return auth;
}

/** Test hook — clears the per-site cache (inject distinct pools for a fresh base). */
export function __resetTenantAuthForTests(): void {
  tenantAuthBySite.clear();
}
