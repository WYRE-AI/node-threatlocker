import { RateLimiter } from './rate-limiter.js';
import {
  ServiceError,
  AuthenticationError,
  ForbiddenError,
  NotFoundError,
  RateLimitError,
  ServerError,
  ValidationError,
} from './errors.js';

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
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 30_000);
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
          const retryAfter = parseInt(response.headers.get('retry-after') || '60', 10);
          if (attempt < this.maxRetries) {
            await new Promise(r => setTimeout(r, retryAfter * 1000));
            continue;
          }
          throw new RateLimitError('Rate limit exceeded', retryAfter, responseBody);
        }
        default:
          if (response.status >= 500) {
            lastError = new ServerError(`Server error: ${response.status} for ${path}`, responseBody);
            const retryable =
              response.status === 502 || response.status === 503 || response.status === 504 ||
              (response.status === 500 && options.retryServerErrors === true);
            if (retryable && attempt < this.maxRetries) continue;
            throw lastError;
          }
          throw new ServiceError(`HTTP ${response.status}`, response.status, responseBody);
      }
    }

    throw lastError || new Error('Request failed after retries');
  }
}