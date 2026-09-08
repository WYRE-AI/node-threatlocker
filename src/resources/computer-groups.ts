import type { HttpClient } from '../http.js';
import type { ComputerGroup, ComputerGroupListParams, ComputerGroupDropdownParams } from '../types/index.js';

// portalapi list endpoints return a BARE JSON ARRAY (see pagination.ts /
// real-api-contracts.test.ts, live-verified 2026-08-10) — not an object
// wrapped as `{ groups: [...] }`. computer-groups was missed when the other
// resources were updated for this, so `response.groups` was always
// `undefined` on the real API and every call silently returned `[]`, even
// for organizations with groups. Object-wrapped shapes are kept as a
// defensive fallback in case a given instance/endpoint still wraps.
function unwrapGroups(response: { groups?: ComputerGroup[] } | ComputerGroup[]): ComputerGroup[] {
  return Array.isArray(response) ? response : response.groups || [];
}

export class ComputerGroupsResource {
  constructor(private readonly http: HttpClient) {}

  async list(params: ComputerGroupListParams = {}): Promise<ComputerGroup[]> {
    const response = await this.http.request<{ groups?: ComputerGroup[] } | ComputerGroup[]>('/ComputerGroup/ComputerGroupGetGroupAndComputer', {
      params: params as Record<string, unknown>,
    });
    return unwrapGroups(response);
  }

  async getDropdown(params: ComputerGroupDropdownParams = {}): Promise<ComputerGroup[]> {
    const response = await this.http.request<{ groups?: ComputerGroup[] } | ComputerGroup[]>('/ComputerGroup/ComputerGroupGetDropdownByOrganizationId', {
      params: params as Record<string, unknown>,
    });
    return unwrapGroups(response);
  }
}