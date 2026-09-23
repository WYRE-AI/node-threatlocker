import type { HttpClient } from '../http.js';
import type { AuditLogEntry, AuditLogSearchParams, FileHistoryParams, PaginatedResponse } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function toIsoSeconds(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid audit log date "${String(value)}" — use an ISO 8601 timestamp.`);
  }
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export class AuditLogResource {
  constructor(private readonly http: HttpClient) {}

  async search(params: AuditLogSearchParams = {}): Promise<PaginatedResponse<AuditLogEntry>> {
    // ActionLogGetByParametersV2 contract (threatlocker.kb.help/unified-audit-
    // portalapiactionlog): startDate/endDate and paramsFieldsDto are REQUIRED
    // (omitting dates is HTTP 417 "Invalid Date Range"), and the request must
    // carry a `usenewsearch: true` header. Defaults to the last 24 hours.
    const endDate = toIsoSeconds(params.endDate ?? params.toDate ?? new Date());
    const startDate = toIsoSeconds(
      params.startDate ?? params.fromDate ?? new Date(new Date(endDate).getTime() - DAY_MS),
    );
    const body: Record<string, unknown> = {
      startDate,
      endDate,
      pageNumber: params.pageNumber ?? 1,
      pageSize: params.pageSize ?? 25,
      paramsFieldsDto: [],
      showChildOrganizations: params.childOrganizations ?? false,
    };
    if (params.searchText) body.fullPath = params.searchText;
    if (params.actionType) body.actionType = params.actionType;
    if (params.hostname) body.hostname = params.hostname;

    const { data, pagination } = await this.http.requestWithMeta<any>('/ActionLog/ActionLogGetByParametersV2', {
      method: 'POST',
      body,
      headers: { usenewsearch: 'true' },
    });
    return unwrapPaginatedResponse<AuditLogEntry>(data, params.pageNumber ?? 1, params.pageSize ?? 25, pagination);
  }

  async get(id: number): Promise<AuditLogEntry> {
    return this.http.request<AuditLogEntry>('/ActionLog/ActionLogGetByIdV2', {
      params: { actionLogId: id },
    });
  }

  /**
   * File history for one path on one computer.
   *
   * `GET /ActionLog/ActionLogGetAllForFileHistoryV2` (OpenAPI: "Get All File
   * History by hostname and fullpath"). Query params are `fullPath`,
   * `hostname`, `computerId` (UUID), plus optional `sourceTableId`,
   * `pageNumber`, `pageSize`. The spec lists them all as optional; the live
   * API returns HTTP 417 "Missing Parameters. Unable to load details." unless
   * `fullPath` and at least one of `hostname` or `computerId` are sent.
   * Incomplete calls throw here and are not sent.
   */
  async getFileHistory(params: FileHistoryParams): Promise<AuditLogEntry[]> {
    const query = fileHistoryQuery(params);
    const response = await this.http.request<AuditLogEntry[] | { logs?: AuditLogEntry[] }>(
      '/ActionLog/ActionLogGetAllForFileHistoryV2',
      { params: query },
    );
    // Sibling list endpoints return a bare JSON array. This method originally
    // unwrapped `{ logs }`; keep that shape as a fallback.
    if (Array.isArray(response)) return response;
    return response?.logs ?? [];
  }
}

const FILE_HISTORY_PARAM_ERROR =
  'auditLog.getFileHistory requires fullPath and either hostname or computerId. ' +
  'ActionLogGetAllForFileHistoryV2 returns HTTP 417 "Missing Parameters. Unable to load details." ' +
  'when only fullPath is sent. Pass { fullPath, hostname } or { fullPath, computerId }.';

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function fileHistoryQuery(params: FileHistoryParams): Record<string, unknown> {
  // A string (the previous signature) has typeof 'string', so this also
  // rejects getFileHistory(fullPath) instead of forwarding a bad request.
  if (typeof params !== 'object' || params === null) {
    throw new Error(FILE_HISTORY_PARAM_ERROR);
  }
  const fullPath = nonEmptyString(params.fullPath);
  const hostname = nonEmptyString(params.hostname);
  const computerId = nonEmptyString(params.computerId);
  if (!fullPath || (!hostname && !computerId)) {
    throw new Error(FILE_HISTORY_PARAM_ERROR);
  }

  const query: Record<string, unknown> = { fullPath };
  if (hostname) query.hostname = hostname;
  if (computerId) query.computerId = computerId;
  if (params.sourceTableId != null) query.sourceTableId = params.sourceTableId;
  if (params.pageNumber != null) query.pageNumber = params.pageNumber;
  if (params.pageSize != null) query.pageSize = params.pageSize;
  return query;
}
