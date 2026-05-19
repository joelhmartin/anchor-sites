import type { NextFunction, Request, RequestHandler, Response } from "express";

type Bucket = { tokens: number; updatedAt: number };

export type RateLimitOptions = {
  /** Max requests per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
  /** Function deriving a key from the request (default: client IP). */
  keyFn?: (req: Request) => string;
};

/**
 * In-process token-bucket rate limiter. Sufficient for Phase 1 (single
 * Cloud Run instance, small admin surface). Phase 12 hardening will swap
 * this for a shared store (Redis / pg-boss tick) when worker fan-out lands.
 */
export function rateLimit(opts: RateLimitOptions): RequestHandler & {
  reset: () => void;
} {
  const max = opts.max;
  const windowMs = opts.windowMs;
  const refillPerMs = max / windowMs;
  const keyFn = opts.keyFn ?? ((req: Request) => req.ip ?? "anon");
  const buckets = new Map<string, Bucket>();

  const handler: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const key = keyFn(req);
    const now = Date.now();
    const existing = buckets.get(key);

    let tokens: number;
    if (!existing) {
      tokens = max;
    } else {
      const elapsed = now - existing.updatedAt;
      tokens = Math.min(max, existing.tokens + elapsed * refillPerMs);
    }

    if (tokens < 1) {
      const retrySec = Math.ceil((1 - tokens) / refillPerMs / 1000);
      res
        .status(429)
        .set("Retry-After", String(retrySec))
        .json({ error: "rate limit exceeded", retry_after_seconds: retrySec });
      return;
    }

    buckets.set(key, { tokens: tokens - 1, updatedAt: now });
    next();
  };

  return Object.assign(handler, {
    reset: () => buckets.clear(),
  });
}
