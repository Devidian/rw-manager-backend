# Game data and live updates
<!-- codemap-id: rw-manager-backend/live -->

## Responsibility

Collect game and plugin data, project player privacy and publish live status over WebSockets. Contract changes require reviewing game and frontend consumers.

## Source and tests

- [Game connector](../../src/service/game-connector-websocket-service.ts), [plugin cache](../../src/service/plugin-data-cache-service.ts), and [player projection](../../src/service/player-projection-service.ts) handle ingestion and projection. [Connector event subscriber](../../src/service/server-live-status-service.ts) handles Admin Utils player status and consent revocations.
- [Server status live](../../src/service/server-status-live-service.ts) and [WebSocket routing](../../src/service/websocket-upgrade-router.ts) publish events.
- [Live integration test](../../tests/server-status-live-integration.test.ts) and [plugin cache test](../../tests/plugin-data-cache-service.test.ts) cover related behavior.

## Dependencies

- `rw-plugin-oz-tools/shared-api` — game connector protocol peer. [Connector](../../src/service/game-connector-websocket-service.ts)
- `rw-plugin-oz-admin-utils/exports` — consumes native routes and the `playerStatus` and `playerConsentRevoked` connector events. [Plugin cache](../../src/service/plugin-data-cache-service.ts) and [event subscriber](../../src/service/server-live-status-service.ts)
- `rw-plugin-oz-gps/markers` — consumes native plugin HTTP data when exposed by the game server. [Route list](../../src/service/plugin-data-cache-service.ts)
- `rw-plugin-oz-land-claim/leases-exports` — consumes native plugin HTTP data when exposed by the game server. [Route list](../../src/service/plugin-data-cache-service.ts)
- `rw-plugin-oz-marketplace/trading` — consumes native plugin HTTP data when exposed by the game server. [Route list](../../src/service/plugin-data-cache-service.ts)
- `rw-plugin-oz-shop/traders` — consumes native plugin HTTP data when exposed by the game server. [Route list](../../src/service/plugin-data-cache-service.ts)
