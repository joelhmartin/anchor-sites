# CRM Integration + CTM Install

> Phase 11 (D-052 / D-053). Migration `1747583000000_ctm_crm_columns.cjs`.

## Overview

Anchor Sites integrates with two external services:

- **anchor-hub CRM** — campaign, form, and tracking-number management. The Studio CRM proxy (`GET /api/sites/:id/crm/phone-numbers`) reads CRM data without exposing `CRM_API_KEY` to the browser.
- **CallTrackingMetrics (CTM)** — call-tracking script injected into every tenant page at render time when `ctm_account_id` is set on the site.

Both integrations are **operator-configured** (env secrets) and **never block** site creation or updates on failure (best-effort CRM calls, log + continue).

---

## CTM install (D-052)

### How it works

When `sites.ctm_account_id` is non-null the renderer calls `ctmScriptTag(accountId)` and injects:

```html
<script src="https://cdn.calltracking.com/call-tracking.min.js"
        async
        data-ctm-account-id="<account-id>"></script>
```

The script is placed in `<head>` before any `headExtra` from the site. CTM's runtime swaps the displayed phone number in `<a href="tel:…">` elements at page load.

### Per-site config

Set the CTM account ID in **Studio → Site → Settings → CTM account ID**. The field is:
- `PATCH /api/sites/:id` — `{ "ctm_account_id": "CTM-1234" }` (string or `null` to clear)
- Stored in `sites.ctm_account_id` (text, nullable)

### PhoneNumber block (`phone_number`)

Add a `phone_number` block to any page. The block renders:

```html
<span class="ac-phone-number">
  <a class="ac-phone-number__link" href="tel:+15550001234">(555) 000-1234</a>
</span>
```

CTM finds the `<a href="tel:…">` and swaps the display text without re-rendering. The component uses `React.memo(() => true)` — it **never re-renders** after mount so React cannot undo CTM's DOM swap.

Block schema:
```json
{ "type": "phone_number", "number": "+15550001234", "display": "(555) 000-1234" }
```
`display` is optional; omitting it shows the raw `number`.

`src/server/ctm-hook.ts` exports `runCtmNow()` — call it from integration tests or headless harnesses to trigger CTM's number-swap synchronously.

### Operator secrets (none required for CTM)

CTM only needs the `ctm_account_id` stored per-site. There are no server-side CTM secrets; the script tag embeds the public account ID.

---

## anchor-hub CRM (D-053)

### CRM client

`src/server/crm/client.ts` — three implementations selected at boot by `resolveCrmClient(process.env)`:

| Mode | Condition | Behaviour |
|---|---|---|
| `HttpCrmClient` | `CRM_BASE_URL` + `CRM_API_KEY` set | Real HTTP calls with Bearer auth |
| `StubCrmClient` | Vars missing | Logs calls; returns empty data. Safe for local dev |
| `NullCrmClient` | `CRM_DISABLED=true` | Silently no-ops; never logs. For tests that don't want noise |

### Five-endpoint contract

| Method | Path pattern | Description |
|---|---|---|
| `provisionSite(name)` | `POST /api/sites` | Creates a CRM site; returns `{ id }` |
| `deprovisionSite(crmSiteId)` | `DELETE /api/sites/:id` | Soft-deletes/archives the CRM site |
| `updateSite(crmSiteId, name)` | `PATCH /api/sites/:id` | Renames the CRM site when `display_name` changes |
| `listPhoneNumbers(crmSiteId)` | `GET /api/sites/:id/phone-numbers` | Returns `PhoneNumber[]` for the Studio Integrations tab |
| `listCampaigns(crmSiteId)` | `GET /api/sites/:id/campaigns` | Returns `Campaign[]` (reserved; not yet surfaced in UI) |

All methods accept an optional `fetchFn` override for testing.

### CRM lifecycle hooks

| Anchor event | CRM call | On error |
|---|---|---|
| Site created (`createSiteWithDomains`) | `provisionSite(display_name)` → stores `crm_site_id` | Log + continue; site still created |
| Site display_name changed (`PATCH /api/sites/:id`) | `updateSite(crm_site_id, display_name)` | Log + continue |
| Site archived (`PATCH /api/sites/:id`, `status: "archived"`) | `deprovisionSite(crm_site_id)` | Log + continue |

### CRM sync job (pg-boss)

`src/server/crm/sync-job.ts` — `CRM_SYNC_JOB = "crm.sync"`. Registered in `src/server/jobs/index.ts`. The job re-derives the correct CRM action from the current DB state, making it idempotent:

- `crm_site_id` null → call `provisionSite`
- `status = 'archived'` → call `deprovisionSite`
- Otherwise → call `updateSite`

Failed lifecycle calls (e.g. CRM outage at provision time) can be retried by enqueuing a `crm.sync` job for the affected site.

### Studio Integrations tab

**Studio → Site → Integrations** (CrmTab):

- Shows `crm_site_id` or "not provisioned" message.
- If provisioned, fetches `GET /api/sites/:id/crm/phone-numbers` and lists tracking numbers with a Copy button.
- Always shows block usage notes (PhoneNumber + CRM Form).

### CRM Form block (`crm_form`)

Add a `crm_form` block and paste the embed code from anchor-hub:

```json
{
  "type": "crm_form",
  "embed_code": "<form action=\"…\">…</form>",
  "label": "Contact form"
}
```

- **Live page** — renders `embed_code` via `dangerouslySetInnerHTML`. The embed runs anchor-hub's client JS for form submission.
- **Editor preview** — renders a dashed placeholder (`[CRM Form: Contact form]`). PHI never touches the builder (D-006).

### Operator secrets

Add to Cloud Run and `cloudbuild.yaml` (append to existing `--set-secrets`, do NOT replace):

| Env var | Purpose |
|---|---|
| `CRM_BASE_URL` | Base URL of anchor-hub, e.g. `https://hub.anchorcorps.com` |
| `CRM_API_KEY` | Bearer token for anchor-hub CRM API |
| `CRM_DISABLED` | Set `true` to silence CRM calls without removing the other vars (e.g. staging) |

If both `CRM_BASE_URL` and `CRM_API_KEY` are absent the server uses `StubCrmClient` (logs calls, returns empty data) — safe for local dev without secrets.

---

## API reference

### `GET /api/sites/:siteId/crm/phone-numbers`

Returns the tracking phone numbers for a site from the CRM proxy. Requires admin auth.

**Response:**
```json
{
  "phone_numbers": [
    { "id": "pn-1", "number": "+15550001111", "display": "(555) 000-1111" }
  ]
}
```

Returns `{ "phone_numbers": [] }` when `crm_site_id` is null (site not provisioned).

### `PATCH /api/sites/:id`

Accepts `ctm_account_id` (string | null) in addition to the existing fields. See `docs/admin-ui.md` for the full PATCH spec.

---

## Local dev

No CRM secrets needed locally — `StubCrmClient` is used automatically and logs all calls to stdout. CTM script injection works with any non-empty `ctm_account_id` value in the DB.

To test full CRM lifecycle locally, set `CRM_BASE_URL` + `CRM_API_KEY` pointing at a staging anchor-hub instance.
