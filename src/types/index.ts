export * from './common.js';
import type { PaginationParams } from './common.js';

// Computer types
export interface Computer {
  id: number;
  name: string;
  domain?: string;
  lastSeen?: string;
  operatingSystem?: string;
  computerGroupId?: number;
  organizationId: number;
}

export interface ComputerListParams extends Partial<PaginationParams> {
  // Add specific computer search filters as needed
}

export interface ComputerCheckin {
  id: number;
  computerId: number;
  checkinTime: string;
  version?: string;
  status?: string;
}

export interface ComputerCheckinParams extends Partial<PaginationParams> {
  // ThreatLocker computer IDs are GUIDs, not numeric IDs.
  computerId?: string;
  fromDate?: string;
  toDate?: string;
}

// Computer Group types
export interface ComputerGroup {
  id: number;
  name: string;
  description?: string;
  organizationId: number;
  parentGroupId?: number;
  computersCount?: number;
}

export interface ComputerGroupListParams {
  osType?: string;
  includeAllComputers?: boolean;
  includeGlobal?: boolean;
  includeAllPolicies?: boolean;
  includeOrganizations?: boolean;
  includeParentGroups?: boolean;
}

export interface ComputerGroupDropdownParams {
  organizationId?: number;
}

// Approval Request types
export interface ApprovalRequest {
  id: number;
  applicationName: string;
  filePath: string;
  status: string;
  requestedBy?: string;
  requestedAt: string;
  computerId?: number;
  organizationId: number;
}

export interface ApprovalRequestListParams extends Partial<PaginationParams> {
  /**
   * Status name, mapped to the API's required statusId. Valid: Pending
   * (default), Approved, Rejected, Not Learned, Added to Application,
   * Escalated, Self-Approved.
   */
  status?: string;
  computerId?: number;
}

export interface PermitApplication {
  id: number;
  applicationPath: string;
  approvalRequestId: number;
  status: string;
}

// Audit Log types
export interface AuditLogEntry {
  // Note: ThreatLocker's ActionLogGetByIdV2 endpoint takes actionLogId as a
  // GUID string (confirmed against the official Postman collection), not a
  // numeric id — see AuditLogResource.get().
  id: number;
  actionType: string;
  timestamp: string;
  userId?: number;
  computerId?: number;
  description: string;
  details?: Record<string, unknown>;
}

export interface AuditLogSearchParams extends Partial<PaginationParams> {
  actionType?: string;
  /** Range start (ISO 8601). Defaults to 24h before endDate. Alias: fromDate. */
  startDate?: string | Date;
  /** Range end (ISO 8601). Defaults to now. Alias: toDate. */
  endDate?: string | Date;
  fromDate?: string;
  toDate?: string;
  hostname?: string;
  userId?: number;
  computerId?: number;
}

/**
 * Query for `ActionLogGetAllForFileHistoryV2`.
 *
 * The published OpenAPI spec marks every parameter optional, but the live
 * Portal API returns HTTP 417 "Missing Parameters. Unable to load details."
 * unless `fullPath` plus one of `hostname` or `computerId` is present.
 */
export interface FileHistoryParams {
  /** Full file path. Required. */
  fullPath: string;
  /**
   * Computer hostname. Required unless `computerId` is set.
   */
  hostname?: string;
  /**
   * Computer GUID (not a numeric id). Required unless `hostname` is set.
   */
  computerId?: string;
  /** ActionLog = 1, DenyActionLog = 2, BaselineActionLog = 3, EventLogActionLog = 4. */
  sourceTableId?: number;
  pageNumber?: number;
  pageSize?: number;
}

// Organization types
export interface Organization {
  id: number;
  name: string;
  parentOrganizationId?: number;
  childOrganizationsCount?: number;
  computersCount?: number;
}

export interface OrganizationListParams extends Partial<PaginationParams> {
  // Add specific organization search filters as needed
}

export interface AuthKey {
  key: string;
  organizationId: number;
}