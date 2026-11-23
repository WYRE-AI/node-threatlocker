/**
 * Bounded retry for rate-limited (HTTP 429) ThreatLocker responses.
 *
 * Retry policy: a Retry-After of at most 10 s is waited for and retried
 * once, so a brief burst does not surface as an error. With no Retry-After,
 * or a longer one, a RateLimitError is thrown at once (no invented backoff;
 * the 60 s reported without a header is never used as a delay).
 */
export const RATE_LIMIT_RETRY = {
  /** Retries after the first attempt (at most one). */
  maxRetries: 1,
  /** Longest wait that is retried. A missing or larger Retry-After is not retried. */
  maxWaitMs: 10_000,
};

/** Parses a Retry-After value into milliseconds from `now`; undefined if absent or invalid. */
export function parseRetryAfter(value: string | null | undefined, now: number = Date.now()): number | undefined {
  if (value === null || value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.ceil(Number(trimmed) * 1000);
  // Otherwise it must be an HTTP date ("Wed, 21 Oct 2015 07:28:00 GMT").
  if (!/[a-z]/i.test(trimmed)) return undefined;
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}

/** Whole seconds from a response's Retry-After header (at least 1), or undefined. */
export function retryAfterSecondsOf(res: Response): number | undefined {
  const ms = parseRetryAfter(res.headers.get('retry-after'));
  return ms === undefined ? undefined : Math.max(1, Math.ceil(ms / 1000));
}

/**
 * Milliseconds to wait before retry number `attempt` (0-based), or
 * undefined when the request should not be retried. Only a Retry-After the
 * API sent is waited for: with no header, or one over maxWaitMs, the caller
 * gets the RateLimitError at once (no invented backoff).
 */
export function retryDelayMs(attempt: number, retryAfterMs: number | undefined): number | undefined {
  if (attempt >= RATE_LIMIT_RETRY.maxRetries) return undefined;
  if (retryAfterMs === undefined || retryAfterMs > RATE_LIMIT_RETRY.maxWaitMs) return undefined;
  return retryAfterMs;
}
