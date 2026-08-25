# Contributing to node-threatlocker

Thank you for your interest in contributing to the ThreatLocker Node.js SDK!

## Development Setup

1. **Prerequisites**
   - Node.js 18+
   - npm (comes with Node.js)

2. **Clone and install**
   ```bash
   git clone https://github.com/WYRE-AI/node-threatlocker.git
   cd node-threatlocker
   npm ci
   ```

3. **Development workflow**
   ```bash
   npm run dev        # Watch mode compilation
   npm run build      # Build the project
   npm run test       # Run tests
   npm run lint       # Type checking
   npm run clean      # Clean dist/
   ```

## Project Structure

```
src/
├── client.ts           # Main client class
├── http.ts             # HTTP client with ThreatLocker auth
├── rate-limiter.ts     # Token bucket rate limiter
├── pagination.ts       # Response unwrapping helpers
├── errors.ts           # Error hierarchy
├── types/
│   ├── common.ts       # Base types and interfaces
│   └── index.ts        # All exported types
└── resources/          # API resource classes
    ├── computers.ts
    ├── computer-groups.ts
    ├── approval-requests.ts
    ├── audit-log.ts
    └── organizations.ts

tests/
├── setup.ts            # Test configuration
├── mocks/              # MSW request handlers
└── unit/               # Unit tests
```

## Adding New Resources

To add a new ThreatLocker API resource:

1. **Add types** in `src/types/index.ts`
2. **Create resource class** in `src/resources/your-resource.ts`
3. **Add to client** in `src/client.ts`
4. **Write tests** in `tests/unit/your-resource.test.ts`
5. **Add mock handlers** in `tests/mocks/handlers.ts`

Example resource class:

```typescript
import type { HttpClient } from '../http.js';
import type { YourType, YourListParams, PaginatedResponse } from '../types/index.js';
import { buildSearchBody } from '../types/index.js';
import { unwrapPaginatedResponse } from '../pagination.js';

export class YourResource {
  constructor(private readonly http: HttpClient) {}

  async list(params: YourListParams = {}): Promise<PaginatedResponse<YourType>> {
    const body = buildSearchBody(params);
    const response = await this.http.request<any>('/Your/EndpointPath', {
      method: 'POST',
      body,
    });
    return unwrapPaginatedResponse<YourType>(response, body.pageNumber, body.pageSize);
  }
}
```

## Testing

- **Unit tests**: Located in `tests/unit/`
- **Mocks**: MSW handlers in `tests/mocks/handlers.ts`
- **Coverage**: Run `npm run test:coverage`

### Writing Tests

```typescript
import { describe, it, expect } from 'vitest';
import { ThreatLockerClient } from '../../src/index.js';

describe('YourResource', () => {
  const client = new ThreatLockerClient({
    apiKey: 'test-api-key',
  });

  it('should list items', async () => {
    const result = await client.yourResource.list();
    expect(result.items).toBeDefined();
    expect(result.total).toBeGreaterThan(0);
  });
});
```

## API Patterns

### ThreatLocker Specifics

- **Authentication**: Raw API key in `Authorization` header (no Bearer)
- **Organization scoping**: `OrganizationId` header for multi-tenant
- **POST-based pagination**: Most list endpoints use POST with JSON body
- **Rate limiting**: Default 10 req/sec (configurable)
- **Response format**: Various property names (`items`, `data`, `results`)

### Standard Request Body

```typescript
{
  pageNumber: 1,
  pageSize: 25,
  isAscending: true,
  orderBy: '',
  searchText: '',
  childOrganizations: false
}
```

## Code Style

- **TypeScript**: Strict mode enabled
- **Imports**: Use `.js` extensions for TypeScript imports
- **Exports**: Prefer named exports
- **Error handling**: Use structured error hierarchy
- **Documentation**: JSDoc comments for public APIs

## Commit Guidelines

We use [Conventional Commits](https://conventionalcommits.org/):

- `feat:` New features
- `fix:` Bug fixes
- `docs:` Documentation changes
- `refactor:` Code refactoring
- `test:` Test additions/updates
- `chore:` Maintenance tasks

Example:
```
feat: add computer group management endpoints
fix: handle empty pagination responses
docs: update rate limiting documentation
```

## Release Process

Releases are automated via semantic-release:

1. Commit changes following conventional commit format
2. Push to `main` branch
3. GitHub Actions runs tests and publishes if green
4. Version is automatically determined from commit messages

## Questions?

Open an issue for:
- Bug reports
- Feature requests
- API questions
- Documentation improvements

For security issues, email security@wyre-technology.com.