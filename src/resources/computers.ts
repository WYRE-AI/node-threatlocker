import type { HttpClient } from '../http.js';
import type { Computer, ComputerListParams, ComputerCheckin, ComputerCheckinParams, PaginatedResponse } from '../types/index.js';
import { buildSearchBody } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

export class ComputersResource {
  constructor(private readonly http: HttpClient) {}

  async list(params: ComputerListParams = {}): Promise<PaginatedResponse<Computer>> {
    const body = buildSearchBody(params);
    const { data, pagination } = await this.http.requestWithMeta<any>('/Computer/ComputerGetByAllParameters', {
      method: 'POST',
      body,
    });
    return unwrapPaginatedResponse<Computer>(data, body.pageNumber, body.pageSize, pagination);
  }

  async get(id: number): Promise<Computer> {
    return this.http.request<Computer>('/Computer/ComputerGetForEditById', {
      params: { computerId: id },
    });
  }

  async getCheckins(params: ComputerCheckinParams = {}): Promise<PaginatedResponse<ComputerCheckin>> {
    // ComputerCheckinGetByParameters has its own body shape (computerId,
    // pageNumber, pageSize) — it does not accept the generic search fields
    // (isAscending, orderBy, searchText, childOrganizations) that
    // buildSearchBody() produces for other resources, and critically
    // requires `computerId`, which buildSearchBody() would silently drop
    // (confirmed against the official ThreatLocker Postman collection).
    const pageNumber = params.pageNumber ?? 1;
    const pageSize = params.pageSize ?? 25;
    const body = {
      computerId: params.computerId,
      pageNumber,
      pageSize,
    };
    const { data, pagination } = await this.http.requestWithMeta<any>('/ComputerCheckin/ComputerCheckinGetByParameters', {
      method: 'POST',
      body,
    });
    return unwrapPaginatedResponse<ComputerCheckin>(data, pageNumber, pageSize, pagination);
  }
}