/* eslint-disable camelcase */

// P8-T8.7 — per-site (TENANT) auth tables (D-008/D-020/D-047, Track B).
//
// Better-auth's core schema, but multi-tenant: every row carries a `site_id`
// and uniqueness is scoped PER SITE (the same email can be a member of two
// different tenant sites). One shared renderer (D-003); a request-scoped
// Better-auth instance per `req.site.id` reads/writes only its site's rows
// (the scoping mechanism is D-048, P8-T8.8). SEPARATE from the Studio
// internal-team auth (`auth_*`, P8-T8.2) — these never share rows.
//
// Column names stay CAMELCASE (created case-preserved) so Better-auth's
// Kysely quoted queries match — same rationale as the auth_studio migration.
// `site_id` is the one snake_case column (our convention for FKs to `sites`).

const TS = (pgm) => ({ type: "timestamptz", notNull: true, default: pgm.func("now()") });
const SITE_FK = { type: "uuid", notNull: true, references: '"sites"', onDelete: "CASCADE" };

exports.up = (pgm) => {
  pgm.createTable("tenant_auth_user", {
    id: { type: "text", primaryKey: true },
    site_id: SITE_FK,
    name: { type: "text", notNull: true },
    email: { type: "text", notNull: true },
    emailVerified: { type: "boolean", notNull: true, default: false },
    image: { type: "text" },
    createdAt: TS(pgm),
    updatedAt: TS(pgm),
  });
  // Per-site email uniqueness (NOT global) — the heart of the multi-tenant model.
  pgm.addConstraint("tenant_auth_user", "tenant_auth_user_site_email_unique", {
    unique: ["site_id", "email"],
  });

  pgm.createTable("tenant_auth_session", {
    id: { type: "text", primaryKey: true },
    site_id: SITE_FK,
    expiresAt: { type: "timestamptz", notNull: true },
    token: { type: "text", notNull: true, unique: true },
    createdAt: TS(pgm),
    updatedAt: TS(pgm),
    ipAddress: { type: "text" },
    userAgent: { type: "text" },
    userId: { type: "text", notNull: true, references: '"tenant_auth_user"', onDelete: "CASCADE" },
  });
  pgm.createIndex("tenant_auth_session", ["site_id", "userId"], {
    name: "tenant_auth_session_site_user_idx",
  });

  pgm.createTable("tenant_auth_account", {
    id: { type: "text", primaryKey: true },
    site_id: SITE_FK,
    accountId: { type: "text", notNull: true },
    providerId: { type: "text", notNull: true },
    userId: { type: "text", notNull: true, references: '"tenant_auth_user"', onDelete: "CASCADE" },
    accessToken: { type: "text" },
    refreshToken: { type: "text" },
    idToken: { type: "text" },
    accessTokenExpiresAt: { type: "timestamptz" },
    refreshTokenExpiresAt: { type: "timestamptz" },
    scope: { type: "text" },
    password: { type: "text" },
    createdAt: TS(pgm),
    updatedAt: TS(pgm),
  });
  pgm.addConstraint("tenant_auth_account", "tenant_auth_account_site_provider_unique", {
    unique: ["site_id", "providerId", "accountId"],
  });
  pgm.createIndex("tenant_auth_account", ["site_id", "userId"], {
    name: "tenant_auth_account_site_user_idx",
  });

  pgm.createTable("tenant_auth_verification", {
    id: { type: "text", primaryKey: true },
    site_id: SITE_FK,
    identifier: { type: "text", notNull: true },
    value: { type: "text", notNull: true },
    expiresAt: { type: "timestamptz", notNull: true },
    createdAt: TS(pgm),
    updatedAt: TS(pgm),
  });
  pgm.createIndex("tenant_auth_verification", ["site_id", "identifier"], {
    name: "tenant_auth_verification_site_identifier_idx",
  });

  // Per-site provider config (which login methods a tenant site enables).
  pgm.createTable("tenant_auth_config", {
    site_id: { type: "uuid", primaryKey: true, references: '"sites"', onDelete: "CASCADE" },
    providers: { type: "jsonb", notNull: true, default: pgm.func("'{}'::jsonb") },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createTrigger("tenant_auth_config", "tenant_auth_config_touch_updated_at", {
    when: "BEFORE",
    operation: "UPDATE",
    level: "ROW",
    function: "touch_updated_at",
  });
};

exports.down = (pgm) => {
  pgm.dropTrigger("tenant_auth_config", "tenant_auth_config_touch_updated_at");
  pgm.dropTable("tenant_auth_config");
  pgm.dropTable("tenant_auth_verification");
  pgm.dropTable("tenant_auth_account");
  pgm.dropTable("tenant_auth_session");
  pgm.dropTable("tenant_auth_user");
};
