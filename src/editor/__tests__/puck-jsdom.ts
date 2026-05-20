/**
 * jsdom shim for editor tests. jsdom doesn't implement the browser observer
 * APIs that Puck's drag layer (@dnd-kit) touches at module-load / render time.
 * Import this FIRST (before the Puck barrel) in any editor test that loads Puck.
 * Side-effecting and idempotent; harmless to import outside jsdom.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}
