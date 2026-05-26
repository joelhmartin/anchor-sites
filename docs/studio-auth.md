# Studio control-hub auth (Google OAuth)

How the **internal team** signs into `studio.anchorcorps.com` (the admin hub).
This is the control-hub login (D-034/D-046) — distinct from each tenant site's
own visitor auth (`tenant_auth_*`, Track B). Built on **Better-auth** (D-020).

## Model

Google OAuth, scoped to the Studio host, team-gated. `requireAdmin`
(`src/middleware/requireAdmin.ts`) is **dual-mode**, in priority order:

1. **Studio Better-auth session** — the primary human path (host-only,
   httpOnly cookie on `studio.anchorcorps.com`; the D-032 boundary keeps it off
   tenant hosts).
2. **`X-Admin-Token`** — CI / service / break-glass. Works whenever
   `ADMIN_API_TOKEN` is configured, independent of OAuth.
3. **Local dev auto-grant** — only when in `dev` mode AND no `ADMIN_API_TOKEN`
   is set (D-034 "local = no auth").
4. Otherwise **401**.

The client probes `GET /api/me` (works in all modes) to decide app vs `/login`.

## Mode switch (`src/server/auth/studio-auth.ts`)

`resolveStudioAuthMode(env)`:

| Condition | Mode | Behavior |
|---|---|---|
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `BETTER_AUTH_SECRET` all set | `google` | Real Google OAuth handler mounted |
| secrets absent, `NODE_ENV !== production` | `dev` | Auto-granted dev session (no Google round-trip) |
| secrets absent, production | `disabled` | No Google handler; prod stays on the `X-Admin-Token` |

No live Google call ever happens in dev or tests.

## Env / secrets

| Var | Where | Notes |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Secret Manager → Cloud Run | Google OAuth Web client |
| `GOOGLE_CLIENT_SECRET` | Secret Manager → Cloud Run | — |
| `BETTER_AUTH_SECRET` | Secret Manager → Cloud Run | 32+ random bytes (session signing) |
| `ADMIN_ALLOWED_EMAILS` | env (optional) | comma-sep allowlist for non-Workspace teammates |
| `STUDIO_ALLOWED_DOMAIN` | env (optional) | defaults to `anchorcorps.com` |
| `STUDIO_ORIGIN` | env (optional) | defaults to `https://studio.anchorcorps.com` (prod) / `http://studio.localhost:3000` (dev) |
| `ADMIN_API_TOKEN` | Secret Manager → Cloud Run | the dual-mode CI/service/break-glass token |

**Never commit secret values** (hard rule #8). `.env.example` ships them blank.

## Team gate

`isAllowedStudioEmail(email)` allows an account only when its email domain is
`STUDIO_ALLOWED_DOMAIN` (default `anchorcorps.com`) OR the email is in
`ADMIN_ALLOWED_EMAILS`. It's wired into Better-auth's
`databaseHooks.user.create.before` (throws `APIError` FORBIDDEN), so a non-team
account is never created → never gets a session.

## OAuth callback URL

The Google Console **authorized redirect URI** must be exactly:

```
https://studio.anchorcorps.com/auth/google/callback
```

The code is configured (Better-auth `redirectURI` + a mount shim in
`studio-auth-mount.ts`) to use this path rather than Better-auth's default
`/api/auth/callback/google`, so the operator's already-documented URI works
unchanged.

## Operator prerequisite (one-time, not CLI-doable)

1. Google Cloud Console → APIs & Services → **Credentials** → Create OAuth
   client ID → **Web application**. Authorized redirect URI:
   `https://studio.anchorcorps.com/auth/google/callback`. Consent screen:
   **Internal**.
2. Put the Client ID + secret in **Secret Manager** (project
   `anchor-hub-480305`), plus a generated `BETTER_AUTH_SECRET`.
3. Wire them to the `anchor-sites` Cloud Run service:
   ```
   gcloud run services update anchor-sites --region=us-central1 \
     --update-secrets=GOOGLE_CLIENT_ID=GOOGLE_CLIENT_ID:latest,\
   GOOGLE_CLIENT_SECRET=GOOGLE_CLIENT_SECRET:latest,\
   BETTER_AUTH_SECRET=BETTER_AUTH_SECRET:latest
   ```

## Cutover runbook (zero lock-out)

1. **Before secrets land:** prod is in `disabled` mode — admins use the
   `X-Admin-Token` via `/login?mode=token`. The `auth_*` tables already exist
   (migration shipped) and `requireAdmin` already accepts sessions; there's
   just no Google handler yet.
2. **Provision the secrets** (steps above). On the next revision, the mode
   flips to `google` automatically — the Google handler mounts and "Sign in
   with Google" starts working. **The `X-Admin-Token` keeps working the whole
   time**, so there is no moment where the admin surface 401s.
3. **Verify** real sign-in at `https://studio.anchorcorps.com` with a team
   Google account (operator-run; OAuth is mocked in CI/tests). Confirm a
   non-team account is rejected.
4. **Optional later:** once Google sign-in is confirmed, the `X-Admin-Token`
   can be retired from human use but is kept as the documented CI/service +
   break-glass path (operator decision, 2026-05-26).

## Break-glass

If OAuth ever misconfigures, append `?mode=token` to `/login` and paste the
`ADMIN_API_TOKEN` value (from Secret Manager) to regain access. This is why the
token path is retained.

## Testing

OAuth + sessions are tested with the Google round-trip mocked (supertest +
Better-auth adapter): mode resolution, the team gate through Better-auth's real
create pipeline, host-gated mounting, the dual-mode gate's every branch, and
the client session flow (jsdom, fetch mocked). Real Google sign-in QA is
operator-run once the Client ID is live.
