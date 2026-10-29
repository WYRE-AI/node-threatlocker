import { describe, it, expect, vi, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { ThreatLockerClient, AuthenticationError, ServerError } from '../../src/index.js';
import { HttpClient } from '../../src/http.js';
import { RateLimiter } from '../../src/rate-limiter.js';

const BASE_URL = 'https://portalapi.g.threatlocker.com/portalapi';
const ORG = '11111111-1111-1111-1111-111111111111';
const CHILD = '22222222-2222-2222-2222-222222222222';
const E_ID = '550e8400-e29b-41d4-a716-446655440000';

const makeHttp = (maxRetries: number, organizationId?: string) =>
  new HttpClient({
    baseUrl: BASE_URL,
    apiKey: 'k',
    organizationId,
    maxRetries,
    rateLimiter: new RateLimiter(1000),
  });

afterEach(() => {
  vi.useRealTimers();
});

describe('5xx retry policy', () => {
  const countingHandler = (status: number) => {
    const state = { count: 0 };
    server.use(
      http.get(`${BASE_URL}/Thing`, () => {
        state.count++;
        return HttpResponse.json({ error: 'x' }, { status });
      }),
    );
    return state;
  };

  it('attempts HTTP 500 exactly once by default', async () => {
    const state = countingHandler(500);
    await expect(makeHttp(3).request('/Thing')).rejects.toBeInstanceOf(ServerError);
    expect(state.count).toBe(1);
  });

  it('retries 503 up to maxRetries', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const state = countingHandler(503);
    const p = makeHttp(2).request('/Thing');
    const assertion = expect(p).rejects.toBeInstanceOf(ServerError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(state.count).toBe(3);
  });

  it('retries 500 when retryServerErrors is true', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    const state = countingHandler(500);
    const p = makeHttp(1).request('/Thing', { retryServerErrors: true });
    const assertion = expect(p).rejects.toBeInstanceOf(ServerError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(state.count).toBe(2);
  });

  it('includes the path in the ServerError message', async () => {
    countingHandler(500);
    await expect(makeHttp(0).request('/Thing')).rejects.toThrow('Server error: 500 for /Thing');
  });
});

describe('managedOrganizationId header', () => {
  it('per-request value overrides the client organizationId', async () => {
    const seen: (string | null)[] = [];
    server.use(
      http.get(`${BASE_URL}/Thing`, ({ request }) => {
        seen.push(request.headers.get('ManagedOrganizationId'));
        return HttpResponse.json({});
      }),
    );
    const h = makeHttp(0, ORG);
    await h.request('/Thing');
    await h.request('/Thing', { managedOrganizationId: CHILD });
    expect(seen).toEqual([ORG, CHILD]);
  });

  it('auditLog.get sends header and query params', async () => {
    let seen: { url: URL; org: string | null } | undefined;
    server.use(
      http.get(`${BASE_URL}/ActionLog/ActionLogGetByIdV2`, ({ request }) => {
        seen = { url: new URL(request.url), org: request.headers.get('ManagedOrganizationId') };
        return HttpResponse.json({ eActionLogId: E_ID });
      }),
    );
    const client = new ThreatLockerClient({ apiKey: 'k', organizationId: ORG });
    await client.auditLog.get(E_ID, { sourceTableId: 2, organizationId: `  ${CHILD} ` });
    expect(seen!.org).toBe(CHILD);
    expect(seen!.url.searchParams.get('eActionLogId')).toBe(E_ID);
    expect(seen!.url.searchParams.get('sourceTableId')).toBe('2');
  });

  it('auditLog.get rejects a blank organizationId before any request', async () => {
    const client = new ThreatLockerClient({ apiKey: 'k' });
    await expect(client.auditLog.get(E_ID, { organizationId: '  ' })).rejects.toThrow(/organizationId/);
  });
});

describe('non-JSON 2xx bodies', () => {
  const respond = (body: string | null, init: ResponseInit & { headers?: Record<string, string> }) =>
    server.use(http.get(`${BASE_URL}/Thing`, () => new HttpResponse(body, init)));

  it('returns a text/plain body as a trimmed string', async () => {
    respond('  not-json-key \n', { headers: { 'content-type': 'text/plain' } });
    expect(await makeHttp(0).request('/Thing')).toBe('not-json-key');
  });

  it('parses JSON sent as text/plain', async () => {
    respond('{"a":1}', { headers: { 'content-type': 'text/plain' } });
    expect(await makeHttp(0).request('/Thing')).toEqual({ a: 1 });
  });

  it('returns {} for an empty body', async () => {
    respond('', { headers: { 'content-type': 'text/plain' } });
    expect(await makeHttp(0).request('/Thing')).toEqual({});
  });

  it('returns {} for 204', async () => {
    respond(null, { status: 204 });
    expect(await makeHttp(0).request('/Thing')).toEqual({});
  });
});

describe('organizations.getAuthKey', () => {
  it('normalizes a text body and forwards the organization header', async () => {
    let org: string | null = null;
    server.use(
      http.get(`${BASE_URL}/Organization/OrganizationGetAuthKeyById`, ({ request }) => {
        org = request.headers.get('ManagedOrganizationId');
        return new HttpResponse('secret-key', { headers: { 'content-type': 'text/plain' } });
      }),
    );
    const client = new ThreatLockerClient({ apiKey: 'k' });
    const result = await client.organizations.getAuthKey({ organizationId: CHILD });
    expect(org).toBe(CHILD);
    expect(result).toEqual({ authKey: 'secret-key', key: 'secret-key', organizationId: CHILD });
  });

  it('fills key from authKey for a JSON body', async () => {
    server.use(
      http.get(`${BASE_URL}/Organization/OrganizationGetAuthKeyById`, () =>
        HttpResponse.json({ organizationId: CHILD, authKey: 'abc' }),
      ),
    );
    const client = new ThreatLockerClient({ apiKey: 'k' });
    expect(await client.organizations.getAuthKey()).toEqual({ organizationId: CHILD, authKey: 'abc', key: 'abc' });
  });
});

describe('401 messages', () => {
  it('includes the path in the AuthenticationError message', async () => {
    server.use(http.get(`${BASE_URL}/Thing`, () => HttpResponse.json({ m: 'no' }, { status: 401 })));
    const err = await makeHttp(0).request('/Thing').catch(e => e);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.message).toMatch(/^Authentication failed/);
    expect(err.message).toContain('/Thing');
  });

  it('approvalRequests rethrow with Approval Center guidance and original response', async () => {
    server.use(
      http.post(`${BASE_URL}/ApprovalRequest/ApprovalRequestGetByParameters`, () =>
        HttpResponse.json({ m: 'no' }, { status: 401 }),
      ),
      http.get(`${BASE_URL}/ApprovalRequest/ApprovalRequestGetCount`, () =>
        HttpResponse.json({ m: 'no' }, { status: 401 }),
      ),
    );
    const client = new ThreatLockerClient({ apiKey: 'k' });
    for (const call of [() => client.approvalRequests.list(), () => client.approvalRequests.getPendingCount()]) {
      const err = await call().catch(e => e);
      expect(err).toBeInstanceOf(AuthenticationError);
      expect(err.message).toMatch(/^Authentication failed \(401\) for ApprovalRequest endpoints/);
      expect(err.message).toContain('Approval Center');
      expect(err.response).toEqual({ m: 'no' });
    }
  });
});
