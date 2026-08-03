# Live map layer WebSocket

The cross-repository objective, contract, migration, rollback, risks, and
validation checklist are maintained in `../../docs/active/live-player-position-sync.md`.

This repository owns the authenticated `/api/storage/map-live` WebSocket,
server-scoped subscriber groups, active-server refresh loops, map-layer change
detection, entity-delta fan-out, and ping/pong connection health. REST map
routes remain compatible initial-state and degraded fallback sources.
