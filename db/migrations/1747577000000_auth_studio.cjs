/* eslint-disable camelcase */

// P8-T8.2 — Studio control-hub auth tables (D-034 / D-046, Track A).
//
// Better-auth's core schema (user/session/account/verification) for the STUDIO
// internal-team Google login, mapped to the `auth_*` table names reserved in
// docs/data-model.md. This is the INTERNAL admin auth surface — distinct from
// the per-site TENANT auth tables (`tenant_auth_*` + site_id, P8-T8.7).
//
// Column names are CAMELCASE on purpose: Better-auth's default adapter is
// Kysely, which quotes all identifiers, so it queries `"emailVerified"`,
// `"userId"`, `"createdAt"`, etc. node-pg-migrate quotes column names too, so
// these are created case-preserving and match Better-auth's queries exactly.
// The field set is taken verbatim from `getAuthTables()` (better-auth@1.6.11)
// for the Studio config (emailAndPassword disabled, google provider) — see
// D-046. If the pin bumps and the schema changes, regenerate from
// `getAuthTables()` in a new migration; never edit this one.

const TS_DEFAULT = { type: "timestamptz", notNull: true };

exports.up = (pgm) => {
  pgm.createTable("auth_user", {
    id: { type: "text", primaryKey: true },
    name: { type: "text", notNull: true },
    email: { type: "text", notNull: true, unique: true },
    emailVerified: { type: "boolean", notNull: true, default: false },
    image: { type: "text" },
    createdAt: { ...TS_DEFAULT, default: pgm.func("now()") },
    updatedAt: { ...TS_DEFAULT, default: pgm.func("now()") },
  });

  pgm.createTable("auth_session", {
    id: { type: "text", primaryKey: true },
    expiresAt: { type: "timestamptz", notNull: true },
    token: { type: "text", notNull: true, unique: true },
    createdAt: { ...TS_DEFAULT, default: pgm.func("now()") },
    updatedAt: { ...TS_DEFAULT, default: pgm.func("now()") },
    ipAddress: { type: "text" },
    userAgent: { type: "text" },
    userId: { type: "text", notNull: true, references: '"auth_user"', onDelete: "CASCADE" },
  });
  pgm.createIndex("auth_session", "userId", { name: "auth_session_user_idx" });

  pgm.createTable("auth_account", {
    id: { type: "text", primaryKey: true },
    accountId: { type: "text", notNull: true },
    providerId: { type: "text", notNull: true },
    userId: { type: "text", notNull: true, references: '"auth_user"', onDelete: "CASCADE" },
    accessToken: { type: "text" },
    refreshToken: { type: "text" },
    idToken: { type: "text" },
    accessTokenExpiresAt: { type: "timestamptz" },
    refreshTokenExpiresAt: { type: "timestamptz" },
    scope: { type: "text" },
    password: { type: "text" },
    createdAt: { ...TS_DEFAULT, default: pgm.func("now()") },
    updatedAt: { ...TS_DEFAULT, default: pgm.func("now()") },
  });
  pgm.createIndex("auth_account", "userId", { name: "auth_account_user_idx" });
  pgm.createIndex("auth_account", ["providerId", "accountId"], {
    name: "auth_account_provider_idx",
  });

  pgm.createTable("auth_verification", {
    id: { type: "text", primaryKey: true },
    identifier: { type: "text", notNull: true },
    value: { type: "text", notNull: true },
    expiresAt: { type: "timestamptz", notNull: true },
    createdAt: { ...TS_DEFAULT, default: pgm.func("now()") },
    updatedAt: { ...TS_DEFAULT, default: pgm.func("now()") },
  });
  pgm.createIndex("auth_verification", "identifier", { name: "auth_verification_identifier_idx" });
};

exports.down = (pgm) => {
  // Drop dependents (FK → auth_user) before the parent.
  pgm.dropTable("auth_verification");
  pgm.dropTable("auth_account");
  pgm.dropTable("auth_session");
  pgm.dropTable("auth_user");
};
