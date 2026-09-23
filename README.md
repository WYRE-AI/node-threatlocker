# node-threatlocker

[![Build Status](https://github.com/WYRE-AI/node-threatlocker/actions/workflows/release.yml/badge.svg)](https://github.com/WYRE-AI/node-threatlocker/actions/workflows/release.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org/)

Node.js client library for the [ThreatLocker](https://www.threatlocker.com) Portal API. Zero production dependencies — uses native `fetch` (Node 18+).

> **Note:** This project is maintained by [WYRE-AI](https://github.com/WYRE-AI).

## Features

- **Zero dependencies** — Uses native Node.js `fetch` (18+)
- **Full TypeScript support** — Complete type definitions
- **Built-in rate limiting** — Default 10 req/sec, configurable
- **Error handling** — Structured error types for different scenarios
- **Multi-tenant support** — Organization scoping with `childOrganizations` flag
- **Beta environment support** — Configurable base URL

## Installation

```bash
npm install @wyre-ai/node-threatlocker
```

### Registry Configuration

This package is published to GitHub Packages. Add this to your `.npmrc`:

```
@wyre-ai:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_TOKEN
```

## Quick Start

```typescript
import { ThreatLockerClient } from '@wyre-ai/node-threatlocker';

const client = new ThreatLockerClient({
  apiKey: 'your-api-key',
  organizationId: 'your-org-id', // Optional for multi-tenant scenarios
});

// List computers
const { items: computers } = await client.computers.list({ pageSize: 50 });

// Get computer details
const computer = await client.computers.get(123);

// Search approval requests
const { items: requests } = await client.approvalRequests.list({
  status: 'pending',
  pageSize: 100,
});

// List computer groups
const groups = await client.computerGroups.list({
  includeAllComputers: true,
});

// Search audit logs
const { items: logs } = await client.auditLog.search({
  actionType: 'application_blocked',
  fromDate: '2024-01-01',
  toDate: '2024-12-31',
});

// File history for one path. fullPath plus hostname or computerId is required;
// the Portal API returns HTTP 417 Missing Parameters when only fullPath is sent.
const history = await client.auditLog.getFileHistory({
  fullPath: 'C:\\Windows\\System32\\notepad.exe',
  hostname: 'WS-01',
});
```

## Authentication

ThreatLocker uses raw API key authentication. The authorization header format is:

```
Authorization: <your-api-key>
```

Note: **No `Bearer` prefix** — ThreatLocker expects the raw API key.

For multi-tenant scenarios, you can provide an `organizationId` which will be sent as an `OrganizationId` header for parent-key access patterns.

## Configuration Options

```typescript
const client = new ThreatLockerClient({
  apiKey: 'required-api-key',
  organizationId: 'optional-org-id',
  baseUrl: 'https://betaportalapi.g.threatlocker.com/portalapi', // Optional, defaults to production
  maxRetries: 3, // Optional, default 3
  rateLimitPerSecond: 10, // Optional, default 10 req/sec
});
```

### Environment Support

- **Production**: `https://portalapi.g.threatlocker.com/portalapi` (default)
- **Beta**: `https://betaportalapi.g.threatlocker.com/portalapi`

## API Reference

| Resource | Methods | Description |
|----------|---------|-------------|
| `computers` | `list()`, `get(id)`, `getCheckins()` | Manage computers and check-ins |
| `computerGroups` | `list()`, `getDropdown()` | Computer group management |
| `approvalRequests` | `list()`, `get(id)`, `getPendingCount()`, `getPermitApplication(id)` | Application approval workflow |
| `auditLog` | `search()`, `get(id)`, `getFileHistory({ fullPath, hostname \| computerId })` | Unified audit and action logs |
| `organizations` | `listChildren()`, `getAuthKey()`, `listForMoveComputers()` | Organization management |

### Multi-Tenant Operations

Most list/search endpoints support the `childOrganizations` flag to include data from child organizations:

```typescript
const { items: computers } = await client.computers.list({
  childOrganizations: true,
  pageSize: 100,
});
```

## Pagination

ThreatLocker APIs use POST-based pagination with a request body. All paginated responses return:

```typescript
{
  items: T[],           // The actual data array
  page: number,         // Current page number
  pageSize: number,     // Items per page
  total: number,        // Total item count
  hasMore: boolean      // Whether more pages exist
}
```

Example pagination:

```typescript
let page = 1;
do {
  const result = await client.computers.list({
    pageNumber: page,
    pageSize: 100,
    childOrganizations: true,
  });
  
  // Process result.items
  console.log(`Page ${page}: ${result.items.length} computers`);
  
  page++;
} while (result.hasMore);
```

## Rate Limiting

Built-in token bucket rate limiter with configurable limits:

- **Default**: 10 requests/second
- **Configurable**: Set `rateLimitPerSecond` in client config
- **Automatic retry**: Rate-limited requests are automatically retried

## Error Handling

Structured error types for different scenarios:

```typescript
import { 
  ServiceError, 
  AuthenticationError, 
  ForbiddenError, 
  NotFoundError, 
  ValidationError, 
  RateLimitError, 
  ServerError 
} from '@wyre-ai/node-threatlocker';

try {
  await client.computers.get(999999);
} catch (error) {
  if (error instanceof AuthenticationError) {
    console.log('Invalid API key');
  } else if (error instanceof NotFoundError) {
    console.log('Computer not found');
  } else if (error instanceof RateLimitError) {
    console.log(`Rate limited, retry after ${error.retryAfter} seconds`);
  }
}
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

Apache 2.0 — Copyright WYRE Technology