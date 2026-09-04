# Plugin Authentication, Inbound WebSocket and Mongo-Only Storage

## Objective

Make the backend the authoritative Manager-side peer for secured native plugin routes and outbound game-server WebSockets, and remove the active lowdb `data.json` data path after a verified one-time MongoDB migration.

## Ownership

This service owns encrypted server credential persistence, pairing/recovery state, the game-server WSS endpoint, authenticated event routing, capability and access-state API fields, and MongoDB migration/runtime behavior. It must remain independent of frontend UI and plugin feature logic. Browser session auth remains separate from game-server credential auth.

## Dependencies

The work depends on the versioned Tools protocol, compatible route-owning plugin releases and a reachable MongoDB deployment.

## Auth and WebSocket Checklist

- [ ] Define DTOs/Typia validators for access state, negotiated features and server event envelopes; preserve existing browser API compatibility.
- [~] Add encrypted-at-rest backend credential storage with key configuration and redacted diagnostics; key rotation procedure remains.
- [~] Implement automatic outbound pairing only for a no-credential connection whose actual peer address uniquely matches a fresh master-list server record; trusted proxy and peer-IP-plus-game-port matching reject ambiguous/mismatched peers. `401` recovery and `noAccess` state remain.
- [~] Add the protected WSS upgrade/first-frame authentication, server identity resolution, size limits and disconnect cleanup without tokens in URLs; rate limits, replay/sequence handling and heartbeat hardening remain.
- [ ] Persist negotiated feature state and route `playerStatus` only into the existing server-scoped live cache. Select it over player polling only while a fresh connection advertises that feature; retain REST fallback and stale-cache expiration.
- [x] Update native route clients to attach the credential only after a successful pairing; `/pluginlist` stays unauthenticated discovery.
- [ ] Cover route-auth state transitions, cross-server isolation, failed reconnect, socket authorization, malformed/replayed frames, feature loss, player-list parity and polling fallback.

## Mongo-Only Migration Checklist

- [ ] Inventory every `db/json` import and replace it with repository-layer MongoDB operations; remove JSON fallback writes and startup fallback mode for storage-enabled operation.
- [ ] Make MongoDB availability/configuration a clear startup requirement when `ENABLE_STORAGE=true`; retain a deliberately documented non-storage mode only if current deployment uses one.
- [ ] Write an idempotent migration with an explicit marker/version. On first start import servers, users and all statistics in transactions or verified bulk writes; validate counts, unique identifiers and representative aggregates before marking complete.
- [ ] Only after verification atomically rename `data.json` to `data.json.bak`. Never overwrite an existing backup; fail safely and leave source data intact on any migration, validation or rename error.
- [ ] Remove lowdb dependency/configuration and update Docker, README, tests, deployment examples and operational recovery instructions.
- [ ] After each successful master-list refresh, remove server catalog and live-cache/credential records whose `lastSeen` is older than 30 days (fall back to `createdAt` only for legacy records). Here “offline” means absent from a successfully fetched master list, not one failed query/health check. Remove pins/references safely, but retain every `server_statistics` document and aggregation unchanged.
- [ ] Add indexes and tests for the 30-day boundary, reappearing endpoint, pinned/manual record cleanup, credential/cache cleanup and historical global and per-server aggregate invariance.

## Risks, Rollback and Validation

Credential loss must be recoverable only through the documented local Tools reset and automatic new pairing. A deployment rollback must retain Mongo collections and the `data.json.bak`; restoring an old lowdb-writing binary against migrated data is prohibited. Cleanup never cascades to `server_statistics`: a returned master endpoint keeps its deterministic ID and therefore regains its historical aggregates. Test migration with a copied representative 11+ MB file, restart midway to prove idempotency, compare per-collection counts and selected weekday aggregates, then run `yarn build` and `yarn test`. For the transport, run socket integration tests with permitted local ports and Development-only runtime validation; production is diagnostic/read-only scope.

## Affected Repositories/Services

- `rw-manager-backend`
- `rw-plugin-oz-tools`
- native route-owning OZ plugins
- `devidian-rw-manager`

## Rollback Considerations

Do not roll an old JSON-writing backend over migrated storage. Roll back transport behavior by disabling the Tools WebSocket switch and using REST fallback; pairing reset remains an explicit local administrator action.

## Validation Strategy

Run the migration and transport checks described above, including `yarn build`, `yarn test`, socket integration tests and Development-only runtime proof.
