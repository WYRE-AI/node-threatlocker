> Release notes from 1.0.7 onward are published on the [GitHub Releases page](https://github.com/WYRE-AI/node-threatlocker/releases) instead of here. `@semantic-release/git` was removed from `.releaserc.json` because it tried to push the version bump directly to `main`, which branch protection (added as part of the WYRE-AI org migration, 1.0.6) correctly rejects — semantic-release still bumps and publishes the package version correctly, it just no longer commits that bump back to this file. The history below (1.0.6 and earlier) is kept as the record.

## [1.0.6](https://github.com/WYRE-AI/node-threatlocker/compare/v1.0.5...v1.0.6) (2026-08-25)


### Bug Fixes

* migrate to WYRE-AI org (npm scope, ghcr namespace, registry) ([#25](https://github.com/WYRE-AI/node-threatlocker/issues/25)) ([04190b0](https://github.com/WYRE-AI/node-threatlocker/commit/04190b0c898faf44b045f4ee4c7b229db76b191f))

## [1.0.5](https://github.com/wyre-technology/node-threatlocker/compare/v1.0.4...v1.0.5) (2026-08-13)


### Bug Fixes

* **ci:** bump add-to-project reusable-workflow pin to post-[#44](https://github.com/wyre-technology/node-threatlocker/issues/44) SHA ([#24](https://github.com/wyre-technology/node-threatlocker/issues/24)) ([41f4741](https://github.com/wyre-technology/node-threatlocker/commit/41f47412a442e6aa7dd070765dbc86ab49a96d1f))

## [1.0.4](https://github.com/wyre-technology/node-threatlocker/compare/v1.0.3...v1.0.4) (2026-08-10)


### Bug Fixes

* honor real portalapi contracts — bare-array lists, statusId, audit dates, bare count ([#21](https://github.com/wyre-technology/node-threatlocker/issues/21)) ([ca407d3](https://github.com/wyre-technology/node-threatlocker/commit/ca407d3d3f9a87329ae4084ffa8efc30bbfe28fc)), closes [threatlocker-mcp#43](https://github.com/threatlocker-mcp/issues/43)

## [1.0.3](https://github.com/wyre-technology/node-threatlocker/compare/v1.0.2...v1.0.3) (2026-07-22)


### Bug Fixes

* **build:** ignoreDeprecations for TS7 DTS build breakage (already on ^6.0.3) ([#19](https://github.com/wyre-technology/node-threatlocker/issues/19)) ([4a21b9a](https://github.com/wyre-technology/node-threatlocker/commit/4a21b9ab710a775057bbd660f39ba141ab24260c))
* **security:** SHA-pin auto-add-to-project.yml [@main](https://github.com/main) -> [@6ae1533dd72f](https://github.com/6ae1533dd72f) (warden C-4) ([#13](https://github.com/wyre-technology/node-threatlocker/issues/13)) ([1f61326](https://github.com/wyre-technology/node-threatlocker/commit/1f6132636a5862fff45dd231c653036469662036))

## [1.0.2](https://github.com/wyre-technology/node-threatlocker/compare/v1.0.1...v1.0.2) (2026-05-18)


### Bug Fixes

* include dist/ in published npm package ([#3](https://github.com/wyre-technology/node-threatlocker/issues/3)) ([4cb4f24](https://github.com/wyre-technology/node-threatlocker/commit/4cb4f247fe1a5a19e81732cbc20db148d6a1a197))

## [1.0.1](https://github.com/wyre-technology/node-threatlocker/compare/v1.0.0...v1.0.1) (2026-05-04)


### Bug Fixes

* **add-to-project:** call shared reusable workflow ([#2](https://github.com/wyre-technology/node-threatlocker/issues/2)) ([309407e](https://github.com/wyre-technology/node-threatlocker/commit/309407ea8f600f270cad1a8703ad3f64f7ee84b0))

# 1.0.0 (2026-05-01)


### Features

* initial SDK scaffold for ThreatLocker Portal API ([a928463](https://github.com/wyre-technology/node-threatlocker/commit/a928463044ebe7a41cb8d824aaaa2b3aa9aa40a8))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- `HttpClient` sent the organization-scoping header as `OrganizationId`,
  which the real ThreatLocker Portal API does not recognize — the correct
  header is `ManagedOrganizationId` (confirmed against the live API's
  OpenAPI security schemes and official docs). The wrong name was silently
  ignored, so every request fell back to the API key's default/home
  organization instead of the configured one. This caused
  `computerGroups.list()`/`getDropdown()` to return empty results for
  organizations whose groups live under a non-default (child) org, and
  `organizations.getAuthKey()` to return an empty key when the default org
  has none generated.
- `computers.getCheckins()` dropped the required `computerId` field entirely
  — it built its request body with the generic `buildSearchBody()` helper,
  which only carries pagination fields, so every checkin lookup sent a body
  without `computerId` and the API rejected it as a 400 Bad Request.
  `getCheckins()` now builds its body directly from the confirmed real
  contract (`computerId`, `pageNumber`, `pageSize`).
- `computerGroups.list()` and `getDropdown()` assumed the response was
  wrapped as `{ groups: [...] }`, but (like every other portalapi list
  endpoint, see the `real-api-contracts` tests) the real API returns a bare
  JSON array — `computer-groups.ts` was missed when the rest of the SDK was
  updated for this in v1.0.4, so every call silently returned `[]` even for
  organizations with computer groups. Object-wrapped shapes are kept as a
  defensive fallback.
- `ComputerCheckinParams.computerId` and `AuditLogEntry`'s `actionLogId`
  lookup were typed as `number`; ThreatLocker IDs for these fields are GUID
  strings. Corrected the types to match (no runtime behavior change, since
  the values already flowed through as strings — a documentation/type-safety
  fix to prevent a future caller from passing a numeric id).
- Published npm tarball was missing compiled `dist/` output, causing
  `ERR_MODULE_NOT_FOUND` in consumers. Added an explicit `files` field
  (`["dist"]`) so packaging no longer falls back to `.gitignore` (which
  excludes `dist/`), and added a `prepublishOnly` build step so the
  compiled output is always present in published packages.

### Added

- Initial SDK scaffold for ThreatLocker Portal API
- Support for Computers resource (list, get, getCheckins)
- Support for Computer Groups resource (list, getDropdown)
- Support for Approval Requests resource (list, get, getPendingCount, getPermitApplication)
- Support for Audit Log resource (search, get, getFileHistory)
- Support for Organizations resource (listChildren, getAuthKey, listForMoveComputers)
- Built-in rate limiting (10 req/sec default)
- Multi-tenant support with `childOrganizations` flag
- Beta environment support via configurable `baseUrl`
- Comprehensive error handling with structured error types
- TypeScript support with full type definitions
- Zero runtime dependencies (uses native fetch)

### Security

- Raw API key authentication (no Bearer prefix as required by ThreatLocker)
- Organization ID header support for multi-tenant scenarios
