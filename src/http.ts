import { RateLimiter } from './rate-limiter.js';
import { parseRetryAfter, retryDelayMs } from './rate-limit.js';
import {
  ServiceError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from './errors.js';

/** Wait reported in a RateLimitError when the 429 has no Retry-After. */
const DEFAULT_RETRY_AFTER_SECONDS = 60;

export interface HttpClientConfig {
  baseUrl: string;
  apiKey: string;
  organizationId?: string;
  maxRetries: number;
  rateLimiter: RateLimiter;
}

export interface RequestOptions {
  method?: string;
  params?: Record<string, unknown>;
  body?: unknown;
  /** Extra request headers (e.g. ActionLog V2 requires `usenewsearch: true`). */
  headers?: Record<string, string>;
  /**
   * Organization GUID sent as the `ManagedOrganizationId` header for this one
   * request, overriding the client-level `organizationId`.
   */
  managedOrganizationId?: string;
  /**
   * Also retry HTTP 500 (default false). Retry policy: network errors and
   * 502/503/504 (transient gateway errors) are retried with backoff. 500 is
   * NOT retried by default — ThreatLocker returns it deterministically for bad
   * ids or organization scope, so retrying only multiplies latency.
   */
  retryServerErrors?: boolean;
  /**
   * The request is safe to send again (it only reads). Defaults to true for
   * GET/HEAD/OPTIONS and false otherwise. ThreatLocker does not document
   * that a rate-limited or failed write had no effect, so a request that is
   * not idempotent is never replayed: a 429, 5xx or network error fails at
   * once. Read-only searches sent as POST set this to true.
   */
  idempotent?: boolean;
}

/** Shape of the `pagination` response header portalapi sets on list endpoints. */
export interface PaginationMeta {
  currentPage?: number;
  itemsPerPage?: number;
  totalItems?: number;
  totalPages?: number;
}

export class HttpClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly organizationId?: string;
  private readonly maxRetries: number;
  private readonly rateLimiter: RateLimiter;

  constructor(config: HttpClientConfig) {
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.organizationId = config.organizationId;
    this.maxRetries = config.maxRetries;
    this.rateLimiter = config.rateLimiter;
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const { data } = await this.requestWithMeta<T>(path, options);
    return data;
  }

  /**
   * Like request(), but also surfaces the `pagination` response header —
   * portalapi list endpoints return a bare JSON array and put the totals
   * there, not in the body.
   */
  async requestWithMeta<T>(path: string, options: RequestOptions = {}): Promise<{ data: T; pagination?: PaginationMeta }> {
    const { method = 'GET', params, body } = options;
    const replaySafe = options.idempotent ?? ['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());

    let url = `${this.baseUrl}${path}`;
    if (params) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            for (const v of value) {
              searchParams.append(`${key}[]`, String(v));
            }
          } else {
            searchParams.set(key, String(value));
          }
        }
      }
      const qs = searchParams.toString();
      if (qs) url += `?${qs}`;
    }

    let lastError: Error | null = null;
    let rateLimitDelayMs: number | undefined;
    let rateLimitRetries = 0;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        // A 429 sets its own (bounded) wait; everything else backs off.
        const delay = rateLimitDelayMs ?? Math.min(1000 * 2 ** (attempt - 1), 30_000);
        rateLimitDelayMs = undefined;
        await new Promise(r => setTimeout(r, delay));
      }

      await this.rateLimiter.acquire();

      const headers: Record<string, string> = {
        'Authorization': this.apiKey, // Raw API key, no Bearer prefix
        'Accept': 'application/json',
        ...options.headers,
      };

      // Add organization-scoping header if provided. ThreatLocker's Portal API
      // scopes requests to a specific (child) organization via the
      // `ManagedOrganizationId` header (confirmed against the live API's
      // OpenAPI security schemes and official docs) — NOT `OrganizationId`,
      // which the API does not recognize and silently ignores, causing
      // requests to fall back to the API key's default/home organization.
      const orgScope = options.managedOrganizationId || this.organizationId;
      if (orgScope) {
        headers['ManagedOrganizationId'] = orgScope;
      }

      if (body) headers['Content-Type'] = 'application/json';

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
      } catch (err) {
        lastError = err as Error;
        if (!replaySafe) throw lastError;
        continue;
      }

      if (response.ok) {
        let pagination: PaginationMeta | undefined;
        const paginationHeader = response.headers.get('pagination');
        if (paginationHeader) {
          try { pagination = JSON.parse(paginationHeader) as PaginationMeta; } catch { /* malformed header — ignore */ }
        }
        if (response.status === 204) return { data: {} as T, pagination };
        // Some endpoints send JSON as text/plain (or without a content-type)
        // and some send a bare string; read as text, parse if possible, and
        // otherwise return the trimmed raw string.
        const text = (await response.text()).trim();
        if (!text) return { data: {} as T, pagination };
        try {
          return { data: JSON.parse(text) as T, pagination };
        } catch {
          return { data: text as unknown as T, pagination };
        }
      }

      // Read body safely (text first, then parse)
      let responseBody: unknown;
      const rawText = await response.text();
      try { responseBody = JSON.parse(rawText); }
      catch { responseBody = rawText; }

      switch (response.status) {
        case 400:
          throw new ValidationError('Bad request', [], responseBody);
        case 401:
          throw new AuthenticationError(`Authentication failed (401) for ${path}`, responseBody);
        case 403:
          throw new ForbiddenError('Forbidden', responseBody);
        case 404:
          throw new NotFoundError('Resource not found', responseBody);
        case 429: {
          // Retried at most once, and only for a Retry-After of at most 10 s
          // (see rate-limit.ts). With no Retry-After, or a longer one, the
          // error is thrown at once; the 60 s reported then is never a delay.
          const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'));
          const delay = retryDelayMs(rateLimitRetries, retryAfterMs);
          if (replaySafe && delay !== undefined && attempt < this.maxRetries) {
            rateLimitRetries++;
            rateLimitDelayMs = delay;
            continue;
          }
          const retryAfter =
            retryAfterMs === undefined ? DEFAULT_RETRY_AFTER_SECONDS : Math.max(1, Math.ceil(retryAfterMs / 1000));
          throw new RateLimitError(
            `ThreatLocker rate-limited the request (HTTP 429) for ${path}. Try again in ${retryAfter} s.`,
            retryAfter,
            responseBody,
          );
        }
        default:
          if (response.status >= 500) {
            // A 503 that carries Retry-After keeps the requested wait in the error.
            const retryAfterMs =
              response.status === 503 ? parseRetryAfter(response.headers.get('retry-after')) : undefined;
            const wait =
              retryAfterMs === undefined ? '' : `. Try again in ${Math.max(1, Math.ceil(retryAfterMs / 1000))} s.`;
            lastError = new ServerError(`Server error: ${response.status} for ${path}${wait}`, responseBody, response.status);
            const retryable =
              response.status === 502 || response.status === 503 || response.status === 504 ||
              (response.status === 500 && options.retryServerErrors === true);
            if (retryable && replaySafe && attempt < this.maxRetries) continue;
            throw lastError;
          }
          throw new ServiceError(`HTTP ${response.status}`, response.status, responseBody);
      }
    }

    throw lastError || new Error('Request failed after retries');
  }
}