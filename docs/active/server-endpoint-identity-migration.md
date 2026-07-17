# Server Endpoint Identity Migration

## Objective

Use the master-server endpoint (`ip` + `port`) as the unique server identity
and remove the obsolete unique server Steam-ID index.

## Ownership

- Repository: `rw-manager-backend`
- Components: MongoDB bootstrap and master-server-list reconciliation

## Dependencies

- MongoDB index management through the existing `mongodb` driver
- No API or frontend contract changes

## Risks

- Deployment fails to start if existing MongoDB documents already duplicate an
  `ip` + `port` pair.
- The removed Steam-ID uniqueness must not be confused with the separate,
  retained unique Steam-ID index for users.

## Validation

- [x] Add index-migration coverage.
- [x] Verify master-list reconciliation does not match servers by Steam ID.
- [x] Run focused tests, full tests, and build.

## Affected Services

- Manager backend MongoDB `servers` collection
- Master-server-list refresh executor

## Rollback

Deploying the prior backend is safe for stored data. Recreating `steamId_1`
is only possible after ensuring all server Steam IDs are unique; otherwise the
same duplicate-key failure returns.
