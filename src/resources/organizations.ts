import type { HttpClient } from '../http.js';
import type { Organization, OrganizationListParams, AuthKey, OrganizationGetAuthKeyOptions, PaginatedResponse } from '../types/index.js';
import { buildSearchBody } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

export class OrganizationsResource {
  constructor(private readonly http: HttpClient) {}

  async listChildren(params: OrganizationListParams = {}): Promise<PaginatedResponse<Organization>> {
    // childOrganizations must be true or the endpoint returns an empty list
    // even for MSPs with children (live-verified) — listing children is the
    // whole point of this method, so default it on.
    const body = buildSearchBody({ childOrganizations: true, ...params });
    const { data, pagination } = await this.http.requestWithMeta<any>('/Organization/OrganizationGetChildOrganizationsByParameters', {
      method: 'POST',
      body,
    });
    return unwrapPaginatedResponse<Organization>(data, body.pageNumber, body.pageSize, pagination);
  }

  /**
   * Auth key for an organization. The endpoint has no query params; scope is
   * by `options.organizationId` (sent as `ManagedOrganizationId`). The live
   * API may return a bare string or `{ organizationId, authKey }`; both are
   * normalized so `authKey` and the deprecated `key` are both populated.
   */
  async getAuthKey(options?: OrganizationGetAuthKeyOptions): Promise<AuthKey> {
    const response = await this.http.request<AuthKey | string>('/Organization/OrganizationGetAuthKeyById', {
      managedOrganizationId: options?.organizationId,
    });
    if (typeof response === 'string') {
      return { authKey: response, key: response, organizationId: options?.organizationId };
    }
    const result: AuthKey = { ...response };
    if (result.authKey === undefined && result.key !== undefined) result.authKey = result.key;
    if (result.key === undefined && result.authKey !== undefined) result.key = result.authKey;
    return result;
  }

  async listForMoveComputers(): Promise<Organization[]> {
    const response = await this.http.request<{ organizations?: Organization[] }>('/Organization/OrganizationGetForMoveComputers');
    return response.organizations || [];
  }
}