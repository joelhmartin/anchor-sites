import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { apiFetch } from "../lib/apiFetch.js";
import { getAdminToken } from "../lib/adminToken.js";
import { Button } from "../ui/button.js";
import { Spinner } from "../ui/spinner.js";
import { cn } from "../ui/cn.js";
import type { TemplatePageRef } from "./TemplateDetailDialog.js";

/**
 * Full-screen template preview (W1.1 / D701): a rendered, browsable look at
 * what "Use this template" will actually materialize. Top bar carries the
 * template name, a page switcher over the template's manifest, the primary
 * "Use this template" CTA, and Back; the body is a sandboxed iframe onto
 * `GET /api/templates/:id/preview/:slug`.
 *
 * CREDENTIAL: identical constraints to `SitePreviewPanel`'s iframe (sandbox
 * without `allow-same-origin` ⇒ opaque origin ⇒ no cookies, and an <iframe>
 * can set no headers), so the query string carries a short-lived
 * TEMPLATE-scoped token minted over a normal SPA fetch
 * (`POST /api/templates/:id/preview-token`). Refresh is proactive at ~80% of
 * the TTL with a short retry after a failed mint — same policy as
 * SitePreviewPanel, simplified (no edit sessions to pin around here). The
 * legacy localStorage admin token remains the dev/paste-token fallback.
 */

const TOKEN_REFRESH_FRACTION = 0.8;
const MIN_TOKEN_REFRESH_MS = 5_000;
const TOKEN_RETRY_MS = 20_000;
const FALLBACK_TOKEN_TTL_MS = 10 * 60 * 1000;

export type TemplatePreviewOverlayProps = {
  template: { id: string; name: string };
  pages: TemplatePageRef[];
  onUse: () => void;
  onClose: () => void;
};

export function TemplatePreviewOverlay({ template, pages, onUse, onClose }: TemplatePreviewOverlayProps) {
  const [activeSlug, setActiveSlug] = useState<string | null>(pages[0]?.slug ?? null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function mint(): Promise<void> {
      try {
        const res = await apiFetch<{ token: string; expires_at: string }>(
          `/api/templates/${template.id}/preview-token`,
          { method: "POST" },
        );
        if (cancelled) return;
        setToken(res.token);
        const parsed = Date.parse(res.expires_at);
        const expiresAt = Number.isNaN(parsed) ? Date.now() + FALLBACK_TOKEN_TTL_MS : parsed;
        const delay = Math.max(
          MIN_TOKEN_REFRESH_MS,
          Math.floor((expiresAt - Date.now()) * TOKEN_REFRESH_FRACTION),
        );
        timer = setTimeout(() => void mint(), delay);
      } catch {
        // Keep any token we already hold (valid until its own expiry) and
        // retry shortly; the legacy admin token below is the last resort.
        if (!cancelled) timer = setTimeout(() => void mint(), TOKEN_RETRY_MS);
      }
    }

    void mint();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [template.id]);

  // Esc closes — the overlay is modal in spirit even though it isn't a Dialog.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const effectiveToken = token ?? getAdminToken();
  const src =
    activeSlug && effectiveToken
      ? `/api/templates/${template.id}/preview/${activeSlug}?token=${encodeURIComponent(effectiveToken)}`
      : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${template.name}`}
      className="fixed inset-0 z-50 flex flex-col bg-[#F7F7F8]"
    >
      <div className="flex h-[52px] shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-label="Close preview"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            <X className="h-4 w-4" />
          </button>
          <h2 className="truncate text-sm font-medium text-zinc-900">{template.name}</h2>
        </div>

        <div role="group" aria-label="Pages" className="flex min-w-0 items-center gap-1 overflow-x-auto">
          {pages.map((p) => (
            <button
              key={p.slug}
              type="button"
              aria-pressed={p.slug === activeSlug}
              onClick={() => setActiveSlug(p.slug)}
              className={cn(
                "whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition",
                p.slug === activeSlug
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
              )}
            >
              {p.title}
            </button>
          ))}
        </div>

        <Button variant="dark" size="sm" className="shrink-0 rounded-full px-4" onClick={onUse}>
          Use this template
        </Button>
      </div>

      <div className="flex flex-1 justify-center overflow-auto p-5">
        <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_28px_-8px_rgba(0,0,0,0.12)]">
          {src ? (
            <iframe
              title={`${template.name} preview`}
              src={src}
              key={activeSlug}
              // Same sandbox rationale as SitePreviewPanel: template blocks
              // are authored content; scripts may run but never on our origin.
              sandbox="allow-scripts"
              className="w-full flex-1 border-0"
            />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-zinc-400">
              <Spinner />
              Loading preview…
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
