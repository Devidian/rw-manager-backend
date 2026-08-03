# Server Live Status WebSocket

## Objective

Replace repeated dashboard `/live` requests with one authenticated, bounded
multi-server WebSocket that emits initial snapshots and semantic field deltas.

## Ownership and dependencies

- This repository owns `/api/storage/server-live`, authentication, heartbeat,
  backpressure, stored snapshots, delta publication, and pin-limit enforcement.
- The existing refresh scheduler remains the sole automatic game-server query
  source. The frontend consumes the contract; Bridge and plugins are unaffected.

## Risks and rollback

- Subscription amplification is bounded by `SERVER_LIVE_MAX_SERVER_IDS`.
- `queryData` and `infoData` remain atomic optional fields.
- `/api/storage/server/:id/live` remains available for older clients, explicit
  refreshes, and rollback.

## Validation

- Protocol, routing, auth, heartbeat, delta, fallback, limit, and integration tests.
- Full test/coverage gate plus production TypeScript build.

## Checklist

- [x] Add shared WebSocket routing and heartbeat.
- [x] Add stored snapshots and semantic status deltas.
- [x] Keep central refresh ownership and REST compatibility.
- [x] Add configurable pin and subscription limits.
- [x] Pass automated tests, coverage, and build.
- [ ] Publish RC and perform runtime proxy acceptance.
