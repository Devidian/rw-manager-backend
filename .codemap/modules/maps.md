# Map metadata and layers
<!-- codemap-id: rw-manager-backend/maps -->

## Responsibility

Resolve renderer map metadata and serve map layers and live updates to frontend clients.

## Source and tests

- [Map service](../../src/service/map-service.ts) validates renderer metadata, [server map service](../../src/service/server-map-service.ts) resolves server paths, and [map live service](../../src/service/map-live-service.ts) publishes changes.
- [Server map tests](../../tests/server-map-service.test.ts) cover map routing and metadata.

## Dependencies

- `rw-map-rendering/render` — consumes renderer metadata and tile paths. [Map service](../../src/service/map-service.ts)
