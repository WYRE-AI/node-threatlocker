import type { HttpClient } from '../http.js';
import type { ApprovalRequest, ApprovalRequestListParams, PermitApplication, PaginatedResponse } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';
import { AuthenticationError } from '../errors.js';

/**
 * Status name → statusId mapping, from the official endpoint reference
 * (threatlocker.kb.help/portalapiapprovalrequest). The endpoint hard-requires
 * statusId — omitting it is an HTTP 500 on every live instance.
 */
const STATUS_IDS: Record<string, number> = {
  pending: 1,
  approved: 4,
  notlearned: 6,
  rejected: 10,
  denied: 10, // common alias for Rejected
  addedtoapplication: 12,
  escalated: 13,
  selfapproved: 16,
};

function resolveStatusId(status: string | undefined): number {
  if (!status || status.toLowerCase() === 'all') return 1; // API has no "all"; Pending is the portal default view
  const key = status.toLowerCase().replace(/[\s_-]/g, '');
  const id = STATUS_IDS[key];
  if (id === undefined) {
    throw new Error(
      `Unknown approval request status "${status}". Valid statuses: Pending, Approved, Rejected, ` +
        'Not Learned, Added to Application, Escalated, Self-Approved.',
    );
  }
  return id;
}

const APPROVAL_AUTH_MESSAGE =
  'Authentication failed (401) for ApprovalRequest endpoints. The API key was rejected for the Approval Center; ' +
  'check that the ThreatLocker API user/role has Approval Center (approval request) view permissions for this organization.';

export class ApprovalRequestsResource {
  constructor(private readonly http: HttpClient) {}

  private async guardAuth<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (err) {
      if (err instanceof AuthenticationError) {
        throw new AuthenticationError(APPROVAL_AUTH_MESSAGE, err.response);
      }
      throw err;
    }
  }

  async list(params: ApprovalRequestListParams = {}): Promise<PaginatedResponse<ApprovalRequest>> {
    // Endpoint-specific body — this endpoint uses showChildOrganizations, not
    // the childOrganizations field the other search endpoints take.
    const body = {
      statusId: resolveStatusId(params.status),
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 25,
      isAscending: params.isAscending ?? false,
      orderBy: params.orderBy ?? 'datetime',
      searchText: params.searchText ?? '',
      showChildOrganizations: params.childOrganizations ?? false,
    };
    const { data, pagination } = await this.guardAuth(() => this.http.requestWithMeta<any>('/ApprovalRequest/ApprovalRequestGetByParameters', {
      method: 'POST',
      body,
    }));
    return unwrapPaginatedResponse<ApprovalRequest>(data, body.pageNumber, body.pageSize, pagination);
  }

  async get(id: number): Promise<ApprovalRequest> {
    return this.guardAuth(() => this.http.request<ApprovalRequest>('/ApprovalRequest/ApprovalRequestGetById', {
      params: { approvalRequestId: id },
    }));
  }

  async getPendingCount(params: { includeChildOrganizations?: boolean } = {}): Promise<number> {
    // The endpoint returns a bare integer (live-verified), not an object.
    const response = await this.guardAuth(() => this.http.request<number | { count?: number }>('/ApprovalRequest/ApprovalRequestGetCount', {
      params: params.includeChildOrganizations !== undefined
        ? { includeChildOrganizations: params.includeChildOrganizations }
        : undefined,
    }));
    if (typeof response === 'number') return response;
    return response?.count ?? 0;
  }

  async getPermitApplication(id: number): Promise<PermitApplication> {
    return this.guardAuth(() => this.http.request<PermitApplication>('/ApprovalRequest/ApprovalRequestGetPermitApplicationById', {
      params: { approvalRequestId: id },
    }));
  }
}
