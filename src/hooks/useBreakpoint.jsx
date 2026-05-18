import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Breakpoint Provider + Hook
 *
 * Wrap your app in <BreakpointProvider> once, then call useBreakpoint()
 * anywhere — no import needed beyond the hook itself.
 *
 * Breakpoints match Tailwind defaults:
 *   sm: 640px   md: 768px   lg: 1024px   xl: 1280px   2xl: 1536px
 * ═══════════════════════════════════════════════════════════════════════════
 */

const QUERIES = {
  sm:        "(min-width: 640px)",
  md:        "(min-width: 768px)",
  lg:        "(min-width: 1024px)",
  xl:        "(min-width: 1280px)",
  "2xl":     "(min-width: 1536px)",
  landscape: "(orientation: landscape)",
};

const mediaLists = {};
if (typeof window !== "undefined") {
  for (const [key, query] of Object.entries(QUERIES)) {
    mediaLists[key] = window.matchMedia(query);
  }
}

function getSnapshot() {
  if (typeof window === "undefined") {
    return {
      sm: true, md: true, lg: true, xl: true, "2xl": false,
      landscape: false,
      isMobile: false, isTablet: false, isDesktop: true, isWide: false,
      isLandscape: false, isPortrait: true,
    };
  }

  const sm  = mediaLists.sm.matches;
  const md  = mediaLists.md.matches;
  const lg  = mediaLists.lg.matches;
  const xl  = mediaLists.xl.matches;
  const xxl = mediaLists["2xl"].matches;
  const landscape = mediaLists.landscape.matches;

  return {
    sm, md, lg, xl, "2xl": xxl, landscape,
    isMobile:    !md,
    isTablet:    md && !lg,
    isDesktop:   lg,
    isWide:      xl,
    isLandscape: landscape,
    isPortrait:  !landscape,
  };
}

let cachedSnapshot = getSnapshot();

function subscribe(callback) {
  const handler = () => {
    cachedSnapshot = getSnapshot();
    callback();
  };
  const unsubs = Object.values(mediaLists).map((mql) => {
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  });
  return () => unsubs.forEach((fn) => fn());
}

function getCachedSnapshot() {
  return cachedSnapshot;
}

// ── Context ──────────────────────────────────────────────────────────────────

const BreakpointContext = createContext(null);

export function BreakpointProvider({ children }) {
  const value = useSyncExternalStore(subscribe, getCachedSnapshot, getCachedSnapshot);
  return (
    <BreakpointContext.Provider value={value}>
      {children}
    </BreakpointContext.Provider>
  );
}

export function useBreakpoint() {
  const ctx = useContext(BreakpointContext);
  if (!ctx) throw new Error("useBreakpoint must be used within <BreakpointProvider>");
  return ctx;
}

/**
 * Render-prop component — use breakpoint values inline in JSX
 * without declaring a variable.
 *
 * <Show when="isMobile">mobile only</Show>
 * <Show when="isDesktop">desktop only</Show>
 * <Hide when="isMobile">hidden on mobile</Hide>
 * <Responsive>{(bp) => <img src={bp.isMobile ? small : big} />}</Responsive>
 */
export function Responsive({ children }) {
  const bp = useBreakpoint();
  return typeof children === "function" ? children(bp) : children;
}

export function Show({ when, children }) {
  const bp = useBreakpoint();
  return bp[when] ? children : null;
}

export function Hide({ when, children }) {
  const bp = useBreakpoint();
  return bp[when] ? null : children;
}
