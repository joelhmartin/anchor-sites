/**
 * P11-T11.4 (D-052) — CTM route-change hook scaffold.
 *
 * Call `runCtmNow()` from the tenant SPA's router-change handler to
 * force CTM to re-evaluate the current page and swap phone numbers.
 * In P11 the renderer is SSR-only, so this is a no-op scaffold.
 *
 * Wiring point: when tenant SPA navigation lands (Phase 13+), import
 * this and call `runCtmNow()` in the router's `onRouteChange` callback.
 */
export function runCtmNow(): void {
  if (typeof window !== "undefined") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ctm?.main?.runNow?.();
  }
}
