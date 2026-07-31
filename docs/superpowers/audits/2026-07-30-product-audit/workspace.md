# Workspace audit — `/sites/:slug` (full-screen site workspace)

Slice of the whole-product big-picture audit. Read-only; no code changed. Evidence is code-level
(files read in full: `WorkspacePage.tsx`, `SitePreviewPanel.tsx`, `agent-api.ts`,
`useAgentConversation.ts`, all of `src/admin/components/agent-chat/`, `UserMenu.tsx`,
`StudioWordmark.tsx`, `inline-editor.ts`, `ImagePickerDialog.tsx`, `LinkPopover.tsx`,
`src/editor-overlay/main.ts`, `src/server/preview-overlay.ts`, `src/server/render-hydration.ts`,
`src/server/preview-token.ts`, `src/server/preview-links.ts`, plus the preview/publish routes in
`src/server/routes/admin-pages.ts`, the agent routes in `admin-ai-agent.ts`, and the tenant render
in `routes/page.ts`).

## Premise checks (per operator instruction: verify, don't assume)

- **"Scroll-position loss on ~12-min token refresh — known"** — CONFIRMED mechanically: refresh
  fires at 80% of the 15-min TTL (`SitePreviewPanel.tsx:21-27`), adoption swaps `srcToken`
  (`:188-191`), the `src` change navigates the iframe (React writes `src` through), scroll and any
  in-preview navigation state reset. See D305.
- **"Native `<select>` page switcher is a known wart"** — CONFIRMED at `WorkspacePage.tsx:662-674`. See D314.
- **Brief's publish state list includes "partial"** — MINOR PREMISE CORRECTION: there is no partial
  state; the publish route is a single transaction, all-or-nothing (`admin-pages.ts:718-735`). The
  only "partial" surface is `live_url_ready=false` (published but domain not provisioned), which IS
  handled honestly (`WorkspacePage.tsx:570-596`). Recorded as n/a where relevant.
- **Auto-continue states** — the inter-round `active` flicker is handled via a 4s settle debounce
  (`useAgentConversation.ts:77, 287-302`); deliberately invisible to the user. Pass.
- **Operator has twice rejected the workspace visuals** — code-visible design-language
  inconsistencies recorded in D331; final visual verdict requires operator screenshots (noted, not
  claimed).

## Census — 43 units

| # | Unit | Anchor |
|---|------|--------|
| 1 | Route resolver (loading / error / no-site states) | WorkspacePage.tsx:87-125 |
| 2 | StudioWordmark (chat-rail header, home link) | StudioWordmark.tsx |
| 3 | `?ai_error=1` banner | WorkspacePage.tsx:138, 406-411 |
| 4 | EmptyState + preset chips | agent-chat/EmptyState.tsx |
| 5 | ChatTranscript container (scroll pin, aria-live, enter animation) | ChatTranscript.tsx:110-143; WorkspacePage.tsx:363-377 |
| 6 | UserBubble | ChatTranscript.tsx:50-56 |
| 7 | AssistantMessage + ReasoningDisclosure | ChatTranscript.tsx:58-74; ReasoningDisclosure.tsx |
| 8 | SystemLine (amber captions) | ChatTranscript.tsx:76-78 |
| 9 | ToolStepRow (running/done/error + shimmer) | ToolSteps.tsx:26-62 |
| 10 | TypingPulse | ToolSteps.tsx:64-77 |
| 11 | ChangeCard (summary, Open page, Revert) | agent-chat/ChangeCard.tsx |
| 12 | Composer (textarea, Enter/Shift+Enter, autosize) | Composer.tsx |
| 13 | Send button | Composer.tsx:~93-105 |
| 14 | Stop button | Composer.tsx:~84-91; useAgentConversation.ts:456-464 |
| 15 | Resume button | Composer.tsx:~66-70; WorkspacePage.tsx:434-436 |
| 16 | Usage footer ("N tokens today · +M this turn") | useAgentConversation.ts:466-469 |
| 17 | useAgentConversation state machine (bootstrap, tail, settle, send/stop, 409) | useAgentConversation.ts |
| 18 | streamAgentEvents SSE client | agent-api.ts:60-111 |
| 19 | Chat-rail splitter (drag / keys / dbl-click / persistence) | WorkspacePage.tsx:40-67, 154-202, 444-461 |
| 20 | Top-bar site title | WorkspacePage.tsx:465 |
| 21 | GitHub link | WorkspacePage.tsx:256-260, 468-479 |
| 22 | Viewport toggle (desktop/mobile) | WorkspacePage.tsx:481-506 |
| 23 | Manage link | WorkspacePage.tsx:508-513 |
| 24 | Publish button (disabled states, tooltip) | WorkspacePage.tsx:522-544 |
| 25 | Publish confirmation popover (confirm/cancel, Esc/outside-click, focus) | WorkspacePage.tsx:319-347, 546-643 |
| 26 | Publish success state (live_url ready / provisioning / failed) | WorkspacePage.tsx:553-607 |
| 27 | Publish error state | WorkspacePage.tsx:616 |
| 28 | UserMenu (avatar button, Sites, Sign out) | UserMenu.tsx |
| 29 | Page switcher `<select>` + pagesError state | WorkspacePage.tsx:654-675 |
| 30 | Refresh-preview button | WorkspacePage.tsx:677-684 |
| 31 | Preview frame wrapper (card chrome, viewport widths) | WorkspacePage.tsx:687-701 |
| 32 | Preview skeleton / empty state | SitePreviewPanel.tsx:336-354 |
| 33 | Preview-token mint/refresh loop | SitePreviewPanel.tsx:117-181 |
| 34 | iframe src/key/sandbox + token adoption + suppressed-reload queue | SitePreviewPanel.tsx:82-115, 188-191, 319-412 |
| 35 | Edit toggle | SitePreviewPanel.tsx:261-293, 373-392 |
| 36 | Save-state chip + agent-busy chip | SitePreviewPanel.tsx:358-372 |
| 37 | Inline-editor handle (save cycle, retry, validation revert, flush/destroy, readonly) | lib/inline-editor.ts |
| 38 | Editor overlay (text/rich-text/image chip/link chip/readonly banner) + CSS | src/editor-overlay/*; preview-overlay.ts |
| 39 | ImagePickerDialog (tabs, alt seed) | ImagePickerDialog.tsx |
| 40 | LinkPopover | LinkPopover.tsx |
| 41 | In-preview navigation rewrite | src/server/preview-links.ts |
| 42 | Preview route (query-token auth, CSP, no-store, no-referrer) | admin-pages.ts:280-520 |
| 43 | Publish route (transaction, idempotence, live_url_ready) | admin-pages.ts:693-799 |

## Lenses (20)

Term=Terminality · Grain=Structure/Grain · Org=Organization · Prov=Provenance→Consumption ·
Comp=Comprehension · SVis=State-Visibility · Hon=Honesty · Rev=Reversibility/Safety ·
Idem=Idempotence/Accretion · Fail=Failure/Recovery · Fwd=Precondition/Forward-path ·
Pop=Population/Dark · Sib=Sibling-Coherence · Gate=Gating-Axis · Temp=Temporal-Integrity ·
Cost=Cost/Value · Stab=Contract-Stability · Name=Naming/Least-astonishment ·
A11y=Accessibility (extra) · Conc=Concurrency (extra)

## Ledger — 43 units × 20 lenses (✓ pass · – n/a · D3xx directive; no blanks)

| # | Unit | Term | Grain | Org | Prov | Comp | SVis | Hon | Rev | Idem | Fail | Fwd | Pop | Sib | Gate | Temp | Cost | Stab | Name | A11y | Conc |
|---|------|------|-------|-----|------|------|------|-----|-----|------|------|-----|-----|-----|------|------|------|------|------|------|------|
| 1 | Route resolver | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| 2 | StudioWordmark | – | ✓ | ✓ | – | ✓ | – | ✓ | – | – | – | ✓ | – | ✓ | – | – | – | ✓ | ✓ | ✓ | – |
| 3 | ai_error banner | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | – | – | – | D323 | – | ✓ | ✓ | ✓ | – |
| 4 | EmptyState | ✓ | ✓ | ✓ | – | ✓ | ✓ | D307 | – | ✓ | – | ✓ | ✓ | – | – | – | – | ✓ | ✓ | ✓ | ✓ |
| 5 | Transcript container | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | D327 | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | D320 | ✓ |
| 6 | UserBubble | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | – | – | ✓ | – | – | – | ✓ | ✓ | ✓ | – |
| 7 | AssistantMessage | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – | D327 | ✓ | – | – | – | ✓ | ✓ | ✓ | – |
| 8 | SystemLine | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | – | – | – | ✓ | – | – | – | ✓ | ✓ | ✓ | – |
| 9 | ToolStepRow | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| 10 | TypingPulse | ✓ | ✓ | ✓ | ✓ | ✓ | D310 | ✓ | – | – | – | – | – | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | – |
| 11 | ChangeCard | ✓ | ✓ | D331 | ✓ | ✓ | ✓ | ✓ | D307 | ✓ | ✓ | ✓ | ✓ | ✓ | D328 | ✓ | ✓ | ✓ | ✓ | ✓ | D328 |
| 12 | Composer | ✓ | ✓ | ✓ | ✓ | D319 | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 13 | Send button | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ |
| 14 | Stop button | D300 | ✓ | ✓ | ✓ | ✓ | D300 | D300 | – | ✓ | D300 | D300 | – | ✓ | ✓ | ✓ | – | ✓ | D300 | ✓ | ✓ |
| 15 | Resume button | ✓ | ✓ | ✓ | ✓ | D303 | ✓ | ✓ | – | ✓ | D303 | ✓ | – | ✓ | ✓ | – | – | ✓ | D318 | ✓ | ✓ |
| 16 | Usage footer | – | ✓ | ✓ | ✓ | D322 | ✓ | ✓ | – | – | ✓ | – | ✓ | ✓ | – | D322 | D322 | ✓ | ✓ | ✓ | – |
| 17 | useAgentConversation | ✓ | ✓ | ✓ | ✓ | ✓ | D303 | ✓ | – | ✓ | D309 | ✓ | D324 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | D302 |
| 18 | streamAgentEvents | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | – | – |
| 19 | Splitter | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| 20 | Site title | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | – | – | – | – | – | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | – |
| 21 | GitHub link | – | ✓ | ✓ | D317 | ✓ | – | D317 | – | – | – | ✓ | ✓ | ✓ | ✓ | – | – | D317 | ✓ | ✓ | – |
| 22 | Viewport toggle | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | – |
| 23 | Manage link | – | ✓ | ✓ | – | ✓ | – | ✓ | – | – | – | ✓ | – | ✓ | – | – | – | ✓ | ✓ | ✓ | – |
| 24 | Publish button | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D301 | – | ✓ | ✓ | D312 | – | ✓ | D301 | ✓ | ✓ | ✓ | ✓ | D312 | ✓ |
| 25 | Publish confirm popover | ✓ | ✓ | D315 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | ✓ | D313 | ✓ |
| 26 | Publish success state | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | D321 | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | – |
| 27 | Publish error state | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | – | – | – | ✓ | ✓ | ✓ | – |
| 28 | UserMenu | ✓ | ✓ | D315 | – | ✓ | ✓ | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | – | – | – | ✓ | ✓ | D313 | – |
| 29 | Page switcher | ✓ | ✓ | ✓ | ✓ | ✓ | D306 | ✓ | – | ✓ | ✓ | ✓ | D314 | D314 | – | D311 | ✓ | ✓ | D314 | ✓ | – |
| 30 | Refresh button | ✓ | ✓ | ✓ | ✓ | ✓ | D311 | ✓ | – | ✓ | – | – | – | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | – |
| 31 | Frame wrapper | – | ✓ | ✓ | – | ✓ | – | ✓ | – | – | – | – | – | ✓ | – | – | ✓ | ✓ | D331 | ✓ | – |
| 32 | Preview skeleton | ✓ | ✓ | ✓ | D316 | ✓ | ✓ | ✓ | – | – | ✓ | ✓ | ✓ | ✓ | – | ✓ | D316 | ✓ | ✓ | ✓ | – |
| 33 | Token mint/refresh | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | – | D305 | ✓ | ✓ | ✓ | – | ✓ |
| 34 | iframe src/key | ✓ | ✓ | ✓ | ✓ | ✓ | D304 | D304 | – | ✓ | D304 | ✓ | – | ✓ | – | D329 | D329 | ✓ | ✓ | ✓ | ✓ |
| 35 | Edit toggle | ✓ | ✓ | ✓ | ✓ | D325 | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ |
| 36 | Save-state chip | ✓ | ✓ | ✓ | ✓ | ✓ | D326 | D326 | D326 | – | ✓ | – | ✓ | ✓ | – | D326 | – | ✓ | ✓ | ✓ | – |
| 37 | Inline-editor handle | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | D307 | ✓ | ✓ | ✓ | – | ✓ | D301 | ✓ | ✓ | ✓ | ✓ | – | D308 |
| 38 | Editor overlay + CSS | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 39 | ImagePickerDialog | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D331 | – | ✓ | – | ✓ | ✓ | ✓ | ✓ |
| 40 | LinkPopover | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D330 | D330 | ✓ | – | ✓ | – | ✓ | ✓ | ✓ | ✓ |
| 41 | Preview-links rewrite | ✓ | ✓ | ✓ | ✓ | ✓ | D306 | ✓ | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D305 | ✓ | ✓ | ✓ | – | – |
| 42 | Preview route | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | D304 | – | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |
| 43 | Publish route | ✓ | ✓ | ✓ | ✓ | – | ✓ | D301 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | – | ✓ |

## Directives (D300–D331)

**[D300]** (Stop button × Honesty/Terminality/Failure-Recovery) — «A control named "Stop" must stop the thing, or say what it actually does — and must never strand the UI in a non-terminal state.» Instance: `stop()` only aborts the local tail and appends "Stopped." while the background pg-boss job keeps building (`useAgentConversation.ts:450-464` — the doc comment admits it); worse, `conversation.status` stays `'running'` in local state with the tail dead, so `busy` is true forever: TypingPulse keeps pulsing beside "Stopped.", Publish and Edit stay locked, the transcript freezes while the agent keeps mutating the site, and there is NO reattach affordance (a follow-up send 409s without restarting the tail — `useAgentConversation.ts:432-440`). Only a full page reload recovers. Fix-class: make Stop either a real cancel endpoint or a "keep following" no-op; at minimum never abort the tail on Stop (keep tailing so status can settle), and restart the tail on the 409 path.

**[D301]** (Publish pill / publish route / inline saves × Honesty/Gating-Axis) — «"Publish" must actually gate what reaches the live site.» Instance: the tenant route renders the CURRENT `blocks` of any `status='published'` row (`routes/page.ts:36-38`), and neither the agent's `update_page` nor inline-editor saves touch `status` — so after a page's first publish, every subsequent AI edit and inline edit ships to the live site instantly, while the workspace shows the Publish button disabled with "Nothing to publish" (`WorkspacePage.tsx:244, 528-535`). The pill's draft-count framing (`admin-pages.ts:693-799` flips status only) presents a release gate that does not exist for already-published pages. Fix-class: snapshot-on-publish (published_blocks column or publish-from-revision) so drafts diverge from live, or rename/reframe the control as first-time "Go live" and surface "edits go live immediately" honestly.

**[D302]** (Conversation bootstrap/send × Concurrency) — «One site must have one running build, regardless of how many tabs are open.» Instance: the turn lock is per-conversation (`admin-ai-agent.ts:221`), but conversation creation has no per-site dedupe (`admin-ai-agent.ts:282-330`), and a tab whose bootstrap found no conversation lazily creates one on first send (`useAgentConversation.ts:400-408`) — two tabs (or a tab opened before the first conversation existed) can run two agent builds against the same site concurrently, interleaving writes; each tab's bootstrap `find()` then shadows the other's conversation. Fix-class: server-side get-or-create one conversation per site (or a per-SITE turn claim), returning the existing one on POST.

**[D303]** (Resume button / error state × Failure-Recovery/State-Visibility/Comprehension) — «A failed build must say it failed and why, where the user is looking.» Instance: on `status:'error'` the ONLY surface is a bare "Resume" button above the composer (`WorkspacePage.tsx:434-436`); no transcript row explains the failure — `history.ts:55-103` derives text/steps/changes but never a terminal system line, and `applySettledStatus` adds nothing — so a user reconnecting to an errored conversation sees a transcript that just trails off, plus an unexplained "Resume". Turn-end reasons (budget/max_tools/error) are invisible after reload. Fix-class: persist a terminal status row per turn (or derive one from the conversation's status/last job error) and render it as the existing SystemLine.

**[D304]** (iframe + preview route × State-Visibility/Honesty/Failure-Recovery) — «Every load failure of the product's primary surface needs a designed state.» Instance: the sandboxed opaque-origin iframe makes 401/404/500 undetectable by the parent (documented at `SitePreviewPanel.tsx:135-139`), and the preview route answers those with raw JSON (`admin-pages.ts:353-366`) — so an expired-token, deleted-page, or server-error preview renders naked `{"error":...}` JSON (or a blank frame) inside the polished browser-window chrome with no recovery affordance. Fix-class: server-render a human, styled error page for preview-route failures (it is HTML for humans by definition), including a "refresh preview" hint.

**[D305]** (Token refresh loop × Temporal-Integrity) — «Background credential maintenance must not destroy foreground context.» Instance: every ~12 min (80% of 15-min TTL) the re-minted token is adopted into `src` (`SitePreviewPanel.tsx:188-191, 319-325`), navigating the iframe: scroll position, form state, and any in-preview navigation are silently reset to the switcher's page. (Trade-off noted: proactive re-render also re-bakes fresh tokens into rewritten links, `preview-links.ts`; a lazy fix must cover that.) Fix-class: adopt refreshed tokens lazily (on the next user-driven reload/page-switch/nonce bump) and let in-frame links re-authenticate via a short server-side grace or self-refreshing redirect, instead of proactively navigating a healthy frame.

**[D306]** (In-preview navigation × State-Visibility) — «What the frame shows and what the shell says must not diverge.» Instance: `preview-links.ts` (correctly) lets clicks navigate to sibling-page previews, but the shell never learns — the page `<select>` (`WorkspacePage.tsx:662-674`) still shows the old page, and any refresh/token-adopt/nonce bump snaps the frame back to the select's page, discarding where the user browsed to. No channel exists (opaque origin, `script-src 'none'` in plain preview). Fix-class: allow one nonce'd notifier `<script>` in preview that postMessages the current pageId to the parent (mirror of the edit bridge), and sync the switcher.

**[D307]** (EmptyState copy + ChangeCard/inline edits × Honesty/Reversibility) — «Do not promise reversibility the product doesn't have.» Instance: EmptyState claims "every change is revertible" (`EmptyState.tsx:15-17`), but: history-rebuilt `page_created` cards deliberately drop `revision_id` (`history.ts:44-52`), `site_updated`/`template_applied`/`image_imported`/brand-token changes have no revert anywhere, and inline edits write `source:'inline'` revisions the workspace exposes NO undo for (revert UI lives only in /manage). Fix-class: soften the claim to match coverage, and add an undo affordance for the inline-edit session (last-revision revert on the save chip).

**[D308]** (Inline-editor handle × Concurrency) — «Whole-document last-write-wins saves must carry a concurrency token.» Instance: the handle snapshots `blocks` once at edit start (`inline-editor.ts:306-316`) and every save POSTs the ENTIRE array (`:157-162`) — an agent change (or a second tab's edit) landing after `loadInitial` is silently clobbered by the next inline save; the `agentBusy` readonly guard narrows but cannot close the window (4s settle debounce; turn finishing right after edit start). Fix-class: optimistic concurrency — send the base revision id with the save and 409 on mismatch, surfacing "page changed underneath you — reload".

**[D309]** (Conversation state machine × Failure-Recovery) — «A liveness claim older than its heartbeat is stale and must be shown as such.» Instance: if the worker dies mid-turn the row stays `'running'`; the server's stale takeover (>10 min, `admin-ai-agent.ts:402-408`) only triggers on the NEXT send, while the client shows an indefinite typing pulse with Publish/Edit locked and no "this build looks stalled" affordance (`useAgentConversation.ts` has no staleness check on `updated_at`). Fix-class: client-side stall detection (running + no tail event for N minutes → offer Resume/refresh), surfacing the same takeover the server already permits.

**[D310]** (TypingPulse × State-Visibility) — «Feedback must start when the action starts, not when the backend gets around to it.» Instance: the pulse keys off `busy = status==='running'` only (`useAgentConversation.ts:476`; `ChatTranscript.tsx:133`), so between pressing Send and the pg-boss pickup + status flip (~2-4s) the transcript shows nothing moving. Fix-class: include `sending` in the transcript's busy prop (the publish gate already does, via `onStatusChange`).

**[D311]** (Refresh button / page switcher during edit × State-Visibility) — «A control that will silently defer its effect must say so or be disabled.» Instance: while Edit is on, nonce bumps and page switches are queued, not applied (`SitePreviewPanel.tsx:112-115`) — clicking Refresh (`WorkspacePage.tsx:677-684`) or picking another page visibly does nothing (the select even updates to a page the frame is NOT showing) until edit mode exits. Fix-class: disable Refresh and the switcher while `edit` is on (title: "finish editing first"), or show a "queued — applies after editing" cue.

**[D312]** (Publish button precondition × Forward-path/Accessibility) — «A disabled control must still explain itself to every user.» Instance: with 0 drafts the button is disabled with only a `title` tooltip (`WorkspacePage.tsx:528-535`) — disabled buttons aren't focusable, so keyboard/SR users get no explanation at all, and the popover's "Everything is published." branch (`:610-615`) is unreachable dead copy. Fix-class: keep the button enabled and let the popover carry the state (it already has the copy), or use `aria-disabled` + focusable pattern.

**[D313]** (UserMenu / publish popover × Accessibility) — «If you claim an ARIA role, implement its keyboard contract.» Instance: `role="menu"`/`menuitem` with no arrow-key navigation, no focus move on open, no focus restore on close (`UserMenu.tsx:60-96`); the publish `role="dialog"` popover sets initial focus but has no focus trap and no restore-to-trigger on close (`WorkspacePage.tsx:343-347, 546-551`). Fix-class: either drop to disclosure semantics (no menu role) or add APG keyboard handling; restore focus to the trigger on close in both.

**[D314]** (Page switcher × Sibling-Coherence/Population/Naming) — «The core surface's controls must match the product's design language and expose the data siblings already show.» Instance: a native `<select>` in a pill costume (`WorkspacePage.tsx:662-674`, known wart) — unstylable option list, no draft/published status per page even though sibling PagesTab renders status badges (`PagesTab.tsx:292`), no page management entry point. Fix-class: custom listbox popover reusing PagesTab's status badge; final visual verdict needs operator screenshots.

**[D315]** (Publish popover + UserMenu × Organization/Grain) — «The third hand-rolled copy of a pattern is a primitive begging to exist.» Instance: outside-click + Escape + anchored-panel + focus bookkeeping duplicated in `WorkspacePage.tsx:319-347` and `UserMenu.tsx:33-49` (the comments themselves note the mirroring), inside a 700-line page component. Fix-class: extract `ui/popover.tsx` (anchored, dismissable, focus-managed) and fold both onto it.

**[D316]** (SitePreviewPanel pages fetch × Provenance/Cost) — «Don't re-fetch what your parent already holds — especially if your copy goes stale.» Instance: `SitePreviewPanel` fetches `/api/sites/:id/pages` (`SitePreviewPanel.tsx:66-69`) that `WorkspacePage` already fetched (`WorkspacePage.tsx:234-238`); the panel's copy never reloads on agent change events, so its `firstPageId` fallback can point at a deleted page. Fix-class: pass the pages list (or resolved fallback page id) down as a prop.

**[D317]** (GitHub link × Contract-Stability/Provenance) — «Don't hardcode another system's layout into a URL.» Instance: `https://github.com/${repo}/tree/main/sites/${slug}` (`WorkspacePage.tsx:257-260`) bakes in branch `main` and the `sites/` prefix — a repo on `master` or a changed export layout 404s silently. Fix-class: derive branch/path from the git-state the API already returns (or have the server return the canonical URL).

**[D318]** (Resume button × Naming/Least-astonishment) — «UI affordances shouldn't leak magic strings into user-visible content.» Instance: Resume literally sends the user message "continue" (`WorkspacePage.tsx:436`), which then renders as a user bubble "continue" in the transcript — protocol masquerading as conversation. Fix-class: dedicated resume flag on the message POST (or a labeled system-styled row), not a synthetic user message.

**[D319]** (Composer × Comprehension) — «Input that will be ignored must look ignored.» Instance: while a turn runs, Enter in the textarea silently no-ops (`Composer.tsx:57-61` → `send()` early-returns on `sending`, `useAgentConversation.ts:390-391`) — no cue the message wasn't queued; the 409 "build already running" line only appears if a POST actually fires. Fix-class: visually disable submission while sending (placeholder/hint), or queue the draft with a "will send after this build" cue.

**[D320]** (Transcript container × Accessibility) — «Scope live regions to what deserves announcement.» Instance: `aria-live="polite"` on the whole scroll container (`ChatTranscript.tsx:115`) makes every tool-step append and in-place running→done flip announceable — dozens per build — drowning the assistant's actual answer. Fix-class: move the live region to assistant text + system lines only; steps get `aria-busy`/status on their own row.

**[D321]** (Publish success state × Forward-path) — «Success states must hand the user their next step.» Instance: with no primary domain, `live_url` is null and the success popover shows only "Published N pages." (`WorkspacePage.tsx:570` renders nothing for the null case) — no pointer to Manage → Domains to actually get the site reachable. Fix-class: null-domain branch with a "connect a domain" link (the failed-provisioning branch already points there; the missing-domain branch should too).

**[D322]** (Usage footer × Comprehension/Cost/Temporal) — «Meter what the audience can act on.» Instance: "N tokens today · +M this turn" (`useAgentConversation.ts:466-469`) is operator cost-jargon in a Lovable-style product, keyed to UTC days (`todayKey()`, `:58-60`) so the counter visibly resets mid-evening local time. Fix-class: translate to credits/cost or builds-remaining (per the product's billing axis), keyed to the user's timezone; keep raw tokens behind a tooltip.

**[D323]** (ai_error banner × Temporal-Integrity) — «Error banners must expire with the error.» Instance: `?ai_error=1` (`WorkspacePage.tsx:138, 406-411`) persists in the URL, so the "initial AI build couldn't be started" banner survives reloads and remains after the user has successfully kicked off a build. Fix-class: clear the param (replaceState) on first successful send; make the banner dismissable.

**[D324]** (Conversation bootstrap × Population/Dark) — «Data the system keeps but never shows is a dark population.» Instance: only the newest active/error/running conversation is reachable (`useAgentConversation.ts:322-325`); archived and older conversations — including the orphan twin D302 can create — are invisible everywhere in the product (no history surface in workspace or /manage). Fix-class: either a conversation-history affordance or a hard one-conversation-per-site model (D302's fix) that makes the population impossible.

**[D325]** (Edit toggle × Comprehension) — «The second pillar of the product must be discoverable, not archaeological.» Instance: click-to-edit is entered via a small tertiary "Edit" button on the frame strip (`SitePreviewPanel.tsx:373-392`); nothing in the empty state, chat, or preview hints that direct manipulation exists (EmptyState pitches only chat). Fix-class: first-run hint (tooltip/pulse on the Edit toggle, or an EmptyState line "…or click Edit to change text directly"); operator screenshot needed for final placement verdict.

**[D326]** (Save-state chip × State-Visibility/Safety/Temporal) — «Unsaved work must be visible, and leaving must not lose it.» Instance: the `dirty` state renders NOTHING (`SitePreviewPanel.tsx:358-370` shows only saving/saved/error), so during the 2s debounce (`inline-editor.ts:66`) there is zero unsaved-changes indication; no `beforeunload` guard exists anywhere in src/admin, so closing the tab inside the debounce silently drops the edit (flush only runs on React unmount); and "Saved · just now" is a static string that stays "just now" forever. Fix-class: render dirty ("Unsaved changes…"), add a beforeunload guard while dirty/saving, drop or age the timestamp.

**[D327]** (Transcript accretion / ReasoningDisclosure × Idempotence-Accretion/Population) — «Dead UI must go; permanent per-step rows must collapse.» Instance: since Task A2, `reasoning` is never populated (`history.ts` never sets it; `types.ts:13`), so `ReasoningDisclosure` is unreachable dead code — while its replacement renders EVERY tool step as a permanent transcript row (`ChatTranscript.tsx:124-130`), so a 20-tool build leaves ~20 rows of trace around each assistant message, forever, defeating the "clean conversation" design the disclosure existed for. Fix-class: group a finished turn's step rows into the existing collapsed disclosure (re-populating `reasoning` from the same persisted messages), or delete the component.

**[D328]** (ChangeCard Revert × Gating-Axis/Concurrency) — «Every mutation on a shared surface obeys the same busy gate.» Instance: Publish and Edit are disabled while the agent runs, but ChangeCard's Revert is not — `ChangeCard.tsx` receives no busy prop, so a mid-build revert POSTs a restore that races the running agent's writes on the same page. Fix-class: thread `agentBusy` into ChangeCard and disable Revert (same title copy as Publish).

**[D329]** (Preview nonce per change event × Temporal-Integrity/Cost) — «Progress feedback shouldn't thrash the surface it's showcasing.» Instance: every tailed change event bumps `previewNonce` (`WorkspacePage.tsx:262-265`) and the nonce is in the iframe `key` (`SitePreviewPanel.tsx:398`) — a multi-step build fully remounts and re-renders the preview once per page-write, resetting scroll each time and re-running the whole render route dozens of times per build. Fix-class: debounce/coalesce nonce bumps while `busy` (e.g. refresh at most every few seconds, and once on settle).

**[D330]** (LinkPopover × Forward-path/Population) — «Editing a link must permit the link kinds the product itself authors.» Instance: `URL_PATTERN = /^https?:\/\/.+/i` (`LinkPopover.tsx:14`) rejects site-relative `/about`, `mailto:`, `tel:`, and `#anchor` — yet templates and the agent routinely author exactly those (preview-links.ts exists because of them), so an operator cannot inline-edit a button to point at their own About page. Fix-class: widen validation to relative paths + mailto/tel (mirror the classes preview-links already recognizes), ideally with a page-picker for internal links.

**[D331]** (Shell-wide styling × Naming/Organization — design language) — «One shell, one accent story, tokens not hexes.» Instance (code-visible; FINAL VERDICT NEEDS OPERATOR SCREENSHOTS): Task B6 mandates a black/zinc shell ("no blue buttons"), yet indigo survives piecemeal — ChangeCard's indigo card (`ChangeCard.tsx:41,48`), sparkle gutter icon (`ChatTranscript.tsx:69`), TypingPulse dots (`ToolSteps.tsx:71`), Markdown links, ImagePicker tabs (`ImagePickerDialog.tsx:74`), overlay chips `#4f46e5` (`preview-overlay.ts:103-116`), wordmark accent — while the shell uses raw hexes (`bg-[#F7F7F8]` ×3 in WorkspacePage, bespoke shadow `WorkspacePage.tsx:692`) instead of theme tokens. Fix-class: decide the accent (indigo as deliberate AI-accent color, or zinc everywhere), encode it as Tailwind theme tokens, and sweep the stragglers in one pass.

## Notable passes (evidence the good parts are real)

- Settle-debounce inter-round flicker fix is sound and well-reasoned (`useAgentConversation.ts:77-115, 287-302`).
- Publish is genuinely idempotent and transactional; `live_url_ready` honesty (provisioning vs failed vs ready) is a model answer (`admin-pages.ts:758-791`, `WorkspacePage.tsx:553-607`).
- Preview credential design (site-scoped 15-min HMAC, proactive refresh, keep-valid-token-on-failed-mint, legacy fallback) is coherent end-to-end (`preview-token.ts`, `SitePreviewPanel.tsx:117-191`).
- Preview CSP/sandbox/no-store/no-referrer stack, and the preview-links rewrite boundaries (edit/bridge never propagated), are carefully correct (`admin-pages.ts:429-517`, `preview-links.ts`).
- Edit-session pinning (page id, nonce, token adoption all suppressed for the whole session) correctly prevents mid-edit data loss (`SitePreviewPanel.tsx:95-115, 188-191`).
- The splitter is the accessibility high-water mark: full separator ARIA, keyboard resize, double-click reset, clamped persistence (`WorkspacePage.tsx:154-202, 444-461`).
- Inline-editor save cycle: dirty-restore on terminal failure, validation-reject server-value revert, cancellable retry on destroy, readonly re-sync on overlay reboot (`inline-editor.ts:198-303`).

## Completion count

- Census: **43 units** × Lenses: **20** = **860 cells**, all filled (0 blank).
- Cell verdicts: **575 pass**, **216 n/a**, **69 directive citations** resolving to **32 unique directives (D300–D331)**.
