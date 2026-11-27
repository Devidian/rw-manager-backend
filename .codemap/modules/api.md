# REST API and persistence
<!-- codemap-id: rw-manager-backend/api -->

## Responsibility

Own REST endpoints, authentication, server configuration and MongoDB-backed storage. Preserve router → handler → service → persistence boundaries.

## Source and tests

- [API router](../../src/router/api-router.ts), [storage router](../../src/router/storage-router.ts), [handlers](../../src/handler/) and [DTOs](../../src/dto/) define the public surface.
- [MongoDB adapter](../../src/db/mongodb.ts) and [manager store](../../src/db/manager-store.ts) own backend storage; [configuration](../../src/utils/app-config.ts) selects runtime settings.
- [Global player statistics store](../../src/db/global-player-statistics-store.ts) persists anonymous timestamp/count samples in a separate collection. The [statistics response](../../src/dto/global-statistics-response.ts) retains participating-server buckets and adds global hourly aggregates.
- [Tests](../../tests/) cover request handlers and storage. See [live](live.md) and [maps](maps.md) for specialized flows.
