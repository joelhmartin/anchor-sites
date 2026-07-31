/**
 * D908 — every public tenant response declares an explicit caching contract.
 * Before this, tenant HTML / sitemap.xml / robots.txt shipped with NO
 * Cache-Control at all (verified live): just Express's weak ETag, leaving
 * post-re-publish behavior to browser/intermediary heuristics.
 *
 * Choices, and why:
 *  - HTML → `no-cache`: store, but REVALIDATE on every use. Correctness
 *    first — a publish must be visible on the very next load (the product's
 *    core honesty, W1.3). The weak ETag Express already computes still
 *    yields cheap 304s, so the ~20 KB body isn't re-sent when unchanged.
 *    (`s-maxage` + purge-on-publish is the later optimization; heuristic
 *    caching is the thing being eliminated.)
 *  - sitemap/robots → `public, max-age=300`: crawl surfaces tolerate five
 *    minutes of staleness, and the cap cuts repeated full-DB renders.
 */
export const HTML_CACHE_CONTROL = "no-cache";
export const FEED_CACHE_CONTROL = "public, max-age=300";
