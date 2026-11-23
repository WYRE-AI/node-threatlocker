import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { RateLimitError } from '../../src/index.js';
import { HttpClient } from '../../src/http.js';
import { RateLimiter } from '../../src/rate-limiter.js';
import { RATE_LIMIT_RETRY, parseRetryAfter, retryDelayMs } from '../../src/rate-limit.js';

const BASE_URL = 'https://portalapi.g.threatlocker.com/portalapi';

const makeHttp = (maxRetries = 3) =>
  new HttpClient({ baseUrl: BASE_URL, apiKey: 'k', maxRetries, rateLimiter: new RateLimiter(1000) });

/** Answers each request with the next response in `responses` (the last one repeats). */
function sequence(responses: Array<() => Response>) {
  const state = { count: 0 };
  server.use(
    http.get(`${BASE_URL}/Thing`, () => {
      const next = responses[Math.min(state.count, responses.length - 1)]!;
      state.count++;
      return next();
    }),
  );
  return state;
}

const limited = (retryAfter?: string, status = 429) => () =>
  HttpResponse.json({ message: 'Too many requests' }, { status, headers: retryAfter ? { 'retry-after': retryAfter } : {} });
const ok = () => HttpResponse.json({ ok: true });

describe('parseRetryAfter', () => {
  it('reads delay-seconds, rounding fractions up', () => {
    expect(parseRetryAfter('5')).toBe(5000);
    expect(parseRetryAfter('0.5')).toBe(500);
    expect(parseRetryAfter(' 0 ')).toBe(0);
  });

  it('reads an HTTP date relative to now', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:07 GMT', now)).toBe(7000);
    expect(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', now)).toBe(0);
  });

  it('ignores missing or invalid values', () => {
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter('-3')).toBeUndefined();
  });
});

describe('retryDelayMs', () => {
  it('uses Retry-After when given, up to 10 s', () => {
    expect(retryDelayMs(0, 3000)).toBe(3000);
    expect(retryDelayMs(0, 0)).toBe(0);
    expect(retryDelayMs(0, RATE_LIMIT_RETRY.maxWaitMs)).toBe(10_000);
  });

  it('does not retry without Retry-After (no invented backoff)', () => {
    expect(retryDelayMs(0, undefined)).toBeUndefined();
  });

  it('retries at most once', () => {
    expect(RATE_LIMIT_RETRY.maxRetries).toBe(1);
    expect(retryDelayMs(1, 1000)).toBeUndefined();
  });

  it('does not wait longer than maxWaitMs', () => {
    expect(retryDelayMs(0, RATE_LIMIT_RETRY.maxWaitMs + 1)).toBeUndefined();
  });
});

describe('HTTP 429 retry', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('waits for Retry-After (no extra backoff) and returns the retried success', async () => {
    const state = sequence([limited('2'), ok]);

    const pending = makeHttp().request('/Thing');
    await vi.advanceTimersByTimeAsync(1999);
    expect(state.count).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(state.count).toBe(2);
  });

  it('gives up after two retries and reports HTTP 429 with the last Retry-After', async () => {
    const state = sequence([limited('3')]);

    const pending = makeHttp(5).request('/Thing');
    const assertion = expect(pending).rejects.toThrow(
      'ThreatLocker rate-limited the request (HTTP 429) for /Thing. Try again in 3 s.',
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;

    expect(state.count).toBe(RATE_LIMIT_RETRY.maxRetries + 1);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RateLimitError);
    expect((error as RateLimitError).retryAfter).toBe(3);
    expect((error as RateLimitError).statusCode).toBe(429);
  });

  it('does not wait for a Retry-After longer than 10 s', async () => {
    const state = sequence([limited('60')]);

    await expect(makeHttp().request('/Thing')).rejects.toThrow(/HTTP 429.*Try again in 60 s\./);
    expect(state.count).toBe(1);
  });

  it('fails at once without Retry-After and reports 60 s (never used as a delay)', async () => {
    const state = sequence([limited()]);

    const error = await makeHttp().request('/Thing').catch((e: unknown) => e);

    expect(state.count).toBe(1);
    expect((error as Error).message).toMatch(/HTTP 429.*Try again in 60 s\./);
    expect((error as RateLimitError).retryAfter).toBe(60);
  });

  it('reports Retry-After: 0 as 1 s after the single retry', async () => {
    const state = sequence([limited('0')]);

    const pending = makeHttp().request('/Thing').catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(0);
    const error = await pending;

    expect(state.count).toBe(RATE_LIMIT_RETRY.maxRetries + 1);
    expect((error as Error).message).toMatch(/Try again in 1 s\./);
    expect((error as RateLimitError).retryAfter).toBe(1);
  });

  it('never retries more than maxRetries allows', async () => {
    const state = sequence([limited('1')]);

    const pending = makeHttp(1).request('/Thing');
    const assertion = expect(pending).rejects.toBeInstanceOf(RateLimitError);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    expect(state.count).toBe(2);
  });
});

describe('replay safety', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function postSequence(responses: Array<() => Response>) {
    const state = { count: 0 };
    server.use(
      http.post(`${BASE_URL}/Thing`, () => {
        const next = responses[Math.min(state.count, responses.length - 1)]!;
        state.count++;
        return next();
      }),
    );
    return state;
  }

  it('never replays a POST that is not marked idempotent, on a 429 or a 503', async () => {
    const limitedState = postSequence([limited('1')]);
    await expect(makeHttp().request('/Thing', { method: 'POST', body: {} })).rejects.toThrow(
      /HTTP 429.*Try again in 1 s\./,
    );
    expect(limitedState.count).toBe(1);

    const unavailable = postSequence([limited('1', 503)]);
    await expect(makeHttp().request('/Thing', { method: 'POST', body: {} })).rejects.toThrow(
      'Server error: 503 for /Thing. Try again in 1 s.',
    );
    expect(unavailable.count).toBe(1);
  });

  it('retries a read-only POST search marked idempotent', async () => {
    const state = postSequence([limited('1'), ok]);

    const pending = makeHttp().request('/Thing', { method: 'POST', body: {}, idempotent: true });
    await vi.advanceTimersByTimeAsync(1000);

    await expect(pending).resolves.toEqual({ ok: true });
    expect(state.count).toBe(2);
  });

  it('leaves a 503 without Retry-After as it was', async () => {
    postSequence([() => HttpResponse.json({ error: 'x' }, { status: 503 })]);
    await expect(makeHttp(0).request('/Thing', { method: 'POST', body: {} })).rejects.toThrow(
      /^Server error: 503 for \/Thing$/,
    );
  });
});
