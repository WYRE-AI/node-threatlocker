import { describe, it, expect } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.js';
import { ThreatLockerClient } from '../../src/index.js';

// These mocks encode the REAL portalapi contract, live-verified against
// portalapi.h.threatlocker.com on 2026-08-10 and cross-checked against the
// official KB (threatlocker.kb.help/portalapiapprovalrequest, /unified-audit-
// portalapiactionlog): list endpoints return a BARE JSON ARRAY with totals in
// a `pagination` response header; ApprovalRequestGetByParameters 500s without
// statusId; ActionLogGetByParametersV2 417s without startDate/endDate and
// requires paramsFieldsDto + a `usenewsearch` header; ApprovalRequestGetCount
// returns a bare integer.

const BASE_URL = 'https://portalapi.g.threatlocker.com/portalapi';

const client = new ThreatLockerClient({ apiKey: 'test-api-key' });

const paginationHeader = (totalItems: number, currentPage = 1, itemsPerPage = 25) =>
  JSON.stringify({ currentPage, itemsPerPage, totalItems, totalPages: Math.ceil(totalItems / itemsPerPage), firstItem: 1, lastItem: totalItems });

describe('bare-array list responses (all list endpoints)', () => {
  it('computers.list unwraps a bare array body and reads totals from the pagination header', async () => {
    server.use(
      http.post(`${BASE_URL}/Computer/ComputerGetByAllParameters`, () =>
        HttpResponse.json(
          [
            { computerId: 'aaa', computerName: 'WS-01' },
            { computerId: 'bbb', computerName: 'WS-02' },
          ],
          { headers: { pagination: paginationHeader(41) } },
        ),
      ),
    );
    const result = await client.computers.list();
    expect(result.items).toHaveLength(2);
    expect(result.total).toBe(41);
    expect(result.hasMore).toBe(true);
  });

  it('organizations.listChildren sends childOrganizations:true by default (false returns nothing on the real API)', async () => {
    let sentBody: any;
    server.use(
      http.post(`${BASE_URL}/Organization/OrganizationGetChildOrganizationsByParameters`, async ({ request }) => {
        sentBody = await request.json();
        return HttpResponse.json(
          [{ organizationId: '1c69', displayName: 'WYRE Technology' }],
          { headers: { pagination: paginationHeader(1) } },
        );
      }),
    );
    const result = await client.organizations.listChildren();
    expect(sentBody.childOrganizations).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(1);
  });
});

describe('approvalRequests.list — statusId contract', () => {
  const arm = () => {
    const seen: any[] = [];
    server.use(
      http.post(`${BASE_URL}/ApprovalRequest/ApprovalRequestGetByParameters`, async ({ request }) => {
        const body: any = await request.json();
        seen.push(body);
        // Real API: 500 when statusId is absent/invalid
        const valid = [1, 4, 6, 10, 12, 13, 16];
        if (!valid.includes(body.statusId)) {
          return HttpResponse.json(
            { LoggerId: 'x', StatusCode: 500, Message: 'A problem occurred with the request (x)' },
            { status: 500 },
          );
        }
        return HttpResponse.json(
          [{ approvalRequestId: 7, status: body.statusId }],
          { headers: { pagination: paginationHeader(1) } },
        );
      }),
    );
    return seen;
  };

  it('defaults to Pending (statusId 1) so a bare list() call cannot 500', async () => {
    const seen = arm();
    const result = await client.approvalRequests.list();
    expect(seen[0].statusId).toBe(1);
    expect(result.items).toHaveLength(1);
  });

  it('maps documented status names to their statusIds', async () => {
    const seen = arm();
    await client.approvalRequests.list({ status: 'Approved' });
    await client.approvalRequests.list({ status: 'rejected' });
    await client.approvalRequests.list({ status: 'Self-Approved' });
    expect(seen.map((b) => b.statusId)).toEqual([4, 10, 16]);
  });

  it('sends showChildOrganizations (not childOrganizations) for this endpoint', async () => {
    const seen = arm();
    await client.approvalRequests.list({ childOrganizations: true });
    expect(seen[0].showChildOrganizations).toBe(true);
    expect(seen[0]).not.toHaveProperty('childOrganizations');
  });

  it('rejects an unknown status name with an actionable error before any request', async () => {
    const seen = arm();
    await expect(client.approvalRequests.list({ status: 'Bogus' })).rejects.toThrow(/status/i);
    expect(seen).toHaveLength(0);
  });
});

describe('approvalRequests.getPendingCount — bare integer response', () => {
  it('parses the bare number the real endpoint returns', async () => {
    server.use(
      http.get(`${BASE_URL}/ApprovalRequest/ApprovalRequestGetCount`, () =>
        HttpResponse.json(3),
      ),
    );
    await expect(client.approvalRequests.getPendingCount()).resolves.toBe(3);
  });
});

describe('auditLog.search — date-range + paramsFieldsDto + usenewsearch contract', () => {
  const arm = () => {
    const seen: { body: any; headers: Headers }[] = [];
    server.use(
      http.post(`${BASE_URL}/ActionLog/ActionLogGetByParametersV2`, async ({ request }) => {
        const body: any = await request.json();
        seen.push({ body, headers: request.headers });
        // Real API: 417 "Invalid Date Range" without startDate/endDate
        if (!body.startDate || !body.endDate) {
          return HttpResponse.json(
            { LoggerId: 'x', StatusCode: 417, Message: 'Invalid Date Range' },
            { status: 417 },
          );
        }
        return HttpResponse.json(
          [{ actionType: 'Execute', fullPath: 'C:\\x.exe' }],
          { headers: { pagination: paginationHeader(1) } },
        );
      }),
    );
    return seen;
  };

  it('always sends startDate/endDate (defaulting to the last 24h) and paramsFieldsDto', async () => {
    const seen = arm();
    const result = await client.auditLog.search();
    const { body } = seen[0];
    expect(body.startDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.endDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(new Date(body.endDate).getTime() - new Date(body.startDate).getTime()).toBeGreaterThan(0);
    expect(Array.isArray(body.paramsFieldsDto)).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it('sends the usenewsearch header the endpoint requires', async () => {
    const seen = arm();
    await client.auditLog.search();
    expect(seen[0].headers.get('usenewsearch')).toBe('true');
  });

  it('honours caller-supplied startDate/endDate', async () => {
    const seen = arm();
    await client.auditLog.search({ startDate: '2026-08-01T00:00:00Z', endDate: '2026-08-09T00:00:00Z' });
    expect(seen[0].body.startDate).toBe('2026-08-01T00:00:00Z');
    expect(seen[0].body.endDate).toBe('2026-08-09T00:00:00Z');
  });
});

describe('organization-scoping header contract', () => {
  // Confirmed against the live API's OpenAPI security schemes
  // (portalapi.*.threatlocker.com/swagger) and the official docs
  // (threatlocker.kb.help/portalapiorganization,
  // /processing-application-control-approval-requests-through-api): the
  // header is `ManagedOrganizationId`, not `OrganizationId`. The wrong
  // header name is silently ignored by the real API, so requests fall back
  // to the API key's default/home organization — this is what caused
  // computerGroups.list() and organizations.getAuthKey() to silently return
  // empty results for MSP accounts querying a non-default org.
  it('sends ManagedOrganizationId (not OrganizationId) when an organizationId is configured', async () => {
    const scopedClient = new ThreatLockerClient({
      apiKey: 'test-api-key',
      organizationId: 'org-guid-123',
    });
    let sentHeaders: Headers | undefined;
    server.use(
      http.post(`${BASE_URL}/Computer/ComputerGetByAllParameters`, ({ request }) => {
        sentHeaders = request.headers;
        return HttpResponse.json([], { headers: { pagination: paginationHeader(0) } });
      }),
    );
    await scopedClient.computers.list();
    expect(sentHeaders?.get('managedorganizationid')).toBe('org-guid-123');
    expect(sentHeaders?.get('organizationid')).toBeNull();
  });

  it('omits the header entirely when no organizationId is configured', async () => {
    let sentHeaders: Headers | undefined;
    server.use(
      http.post(`${BASE_URL}/Computer/ComputerGetByAllParameters`, ({ request }) => {
        sentHeaders = request.headers;
        return HttpResponse.json([], { headers: { pagination: paginationHeader(0) } });
      }),
    );
    await client.computers.list();
    expect(sentHeaders?.get('managedorganizationid')).toBeNull();
  });
});

describe('computers.getCheckins — computerId contract', () => {
  // Confirmed against the official ThreatLocker Postman collection:
  // ComputerCheckinGetByParameters's body is { computerId (GUID), pageNumber,
  // pageSize, hideHeartbeat } — computerId is required. The generic
  // buildSearchBody() helper (isAscending/orderBy/searchText/
  // childOrganizations) doesn't carry computerId at all, so it was silently
  // dropped and the real API rejected the request as a 400 Bad Request.
  it('includes computerId in the outgoing body', async () => {
    let sentBody: any;
    server.use(
      http.post(`${BASE_URL}/ComputerCheckin/ComputerCheckinGetByParameters`, async ({ request }) => {
        sentBody = await request.json();
        return HttpResponse.json([], { headers: { pagination: paginationHeader(0) } });
      }),
    );
    await client.computers.getCheckins({ computerId: 'computer-guid-456' });
    expect(sentBody.computerId).toBe('computer-guid-456');
  });

  it('the real API 400s when computerId is missing (regression guard for the dropped-field bug)', async () => {
    server.use(
      http.post(`${BASE_URL}/ComputerCheckin/ComputerCheckinGetByParameters`, async ({ request }) => {
        const body: any = await request.json();
        if (!body.computerId) {
          return HttpResponse.json({ Message: 'computerId is required' }, { status: 400 });
        }
        return HttpResponse.json([], { headers: { pagination: paginationHeader(0) } });
      }),
    );
    await expect(client.computers.getCheckins({ computerId: 'computer-guid-456' })).resolves.toBeDefined();
    await expect(client.computers.getCheckins()).rejects.toThrow(/bad request/i);
  });
});

describe('computerGroups.list / getDropdown — bare-array contract', () => {
  // Same bare-array behavior as the other list endpoints (see top of file) —
  // computer-groups was missed when the rest of the SDK was updated for
  // this, so `response.groups` was always undefined on the real API and
  // every call silently returned [].
  it('list() unwraps a bare array response', async () => {
    server.use(
      http.get(`${BASE_URL}/ComputerGroup/ComputerGroupGetGroupAndComputer`, () =>
        HttpResponse.json([
          { id: 1, name: 'Workstations', organizationId: 1 },
          { id: 2, name: 'Servers', organizationId: 1 },
        ]),
      ),
    );
    const groups = await client.computerGroups.list();
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.name)).toEqual(['Workstations', 'Servers']);
  });

  it('getDropdown() unwraps a bare array response', async () => {
    server.use(
      http.get(`${BASE_URL}/ComputerGroup/ComputerGroupGetDropdownByOrganizationId`, () =>
        HttpResponse.json([{ id: 1, name: 'Workstations', organizationId: 1 }]),
      ),
    );
    const groups = await client.computerGroups.getDropdown();
    expect(groups).toHaveLength(1);
  });

  it('still supports an object-wrapped { groups: [...] } response as a defensive fallback', async () => {
    server.use(
      http.get(`${BASE_URL}/ComputerGroup/ComputerGroupGetGroupAndComputer`, () =>
        HttpResponse.json({ groups: [{ id: 1, name: 'Workstations', organizationId: 1 }] }),
      ),
    );
    const groups = await client.computerGroups.list();
    expect(groups).toHaveLength(1);
  });
});
