# Security: Content Security Policy

## Current CSP (Phase 12)

Enabled via `helmet.contentSecurityPolicy({ directives: buildCsp(process.env) })` in `src/server/app.ts`. The `buildCsp()` helper in `src/server/csp.ts` assembles directives at startup from env vars.

### Base directives

| Directive | Values |
|---|---|
| `default-src` | `'self'` |
| `script-src` | `'self' 'unsafe-inline' cdn.calltracking.com unpkg.com` + `ANALYTICS_BASE_URL` origin |
| `style-src` | `'self' 'unsafe-inline'` |
| `img-src` | `'self' data: storage.googleapis.com` |
| `connect-src` | `'self'` + `WEB_VITALS_ENDPOINT`, `SENTRY_DSN`, `ANALYTICS_BASE_URL`, `CSP_CRM_EXTRA_ORIGINS` origins |
| `frame-src` | `'none'` (extended by `CSP_CRM_EXTRA_ORIGINS`) |
| `object-src` | `'none'` |
| `base-uri` | `'self'` |

### Env vars that extend the CSP at runtime

| Variable | Effect |
|---|---|
| `ANALYTICS_BASE_URL` | Origin added to `script-src` and `connect-src` |
| `WEB_VITALS_ENDPOINT` | Origin added to `connect-src` |
| `SENTRY_DSN` | Ingest origin added to `connect-src` |
| `CSP_CRM_EXTRA_ORIGINS` | Comma-separated origins added to `connect-src` and `frame-src` |

### Known gap: `'unsafe-inline'` in script-src

`'unsafe-inline'` is required while legacy inline scripts exist (Vite HMR in dev, inline brand-token `<style>` blocks). Migration path:

1. Replace inline scripts with external scripts (move brand-token CSS to a dynamic stylesheet link).
2. Implement nonce-per-request: generate a random nonce in an Express middleware, set it in `res.locals.nonce`, pass it to `helmet` via `nonces`, and inject `<script nonce="${nonce}">` in the shell.
3. Remove `'unsafe-inline'` from `script-src`.

This is deferred to a post-Phase-12 hardening pass.
