# Online Map Layers Backend API

## Objective

Provide validated, read-only, capability-based APIs for sector geometry,
Land Claim areas, Marketplace/Shop area enrichment, local Marketplace offers,
and player map positions without changing the existing terrain renderer.

## Ownership

Owning service: `rw-manager-backend`

The backend owns:

- database/settings discovery and compatibility checks
- read-only adapters for world and plugin persistence
- normalized DTOs, validators, mappers, services, handlers, and routes
- authorization-aware player filtering
- layer capability reporting
- bounded refresh/caching behavior

The frontend owns rendering and interaction. Plugins own their source schemas
and continue writing all game/plugin state.

## Dependencies

- existing active-world resolution through `ServerConfig`
- existing plugin inventory service
- existing map schema-5 metadata and signed coordinate contract
- existing backend user authentication and `admin` role
- real schema inspection of `Areas.db`, `Player.db`, and relevant plugin
  world databases

## Phase 1: Discovery And Contract Fixtures

- [x] Inspect `Areas.db` tables, indexes, column types, sample geometry, area
  names, timestamps, and `rights` identity/permission records.
- [x] Verify whether area length/width are counts or endpoint deltas and
  whether start positions use blocks or another unit.
- [x] Inspect `Player.db` identity, position, and `lastseen` units and verify
  how current online players can be matched deterministically.
- [x] Confirm the Rising World sector size/origin from authoritative local
  runtime/API evidence.
- [x] Resolve Land Claim settings and world database paths from repository
  layout and repository code.
- [x] Verify configured `ownerAreaPermission`, accepted `ozlc*` filtering,
  packed color byte order, claim-sale schema/status, price/currency, and
  timestamp units.
- [x] Verify Marketplace and Shop world database paths and schemas:
  `marketplace_zones.area_id`, active local listings, and
  `shop_zones.area_id`.
- [x] Create minimal sanitized SQLite/settings fixtures for supported,
  plugin-free, sale, Marketplace, Shop, and player-classification behavior.
- [ ] Extend fixtures for every remaining incompatible schema variant.
- [x] Freeze DTO version, coordinate units, and unavailable/error semantics in
  tests and repository documentation.

Verified savegame details are recorded in the workspace-root
`docs/active/online-map-layers-savegame-analysis.md`. The backup contains no
plugins, so plugin settings and plugin-owned schemas remain open gates.

## Proposed Endpoints

```text
GET /api/data/server/map/layers
GET /api/data/server/map/layers/claims
GET /api/data/server/map/layers/players
GET /api/data/server/map/layers/marketplaces/:areaId/offers
```

All responses carry an explicit layer schema version.

### Capability Response

Reports:

- active world identity
- sector geometry constants
- support status for claims, claim sales, Marketplace, Shop, and players
- configured recent-offline threshold in days
- optional diagnostic reason codes suitable for UI states, without paths or
  raw exception text

### Claim Response

Return only normalized UI data:

- stable area ID and name
- half-open block-space minimum X/Z and width/depth
- owner display name when resolvable
- creation time when available
- verified CSS-ready border/fill colors
- sale status and public price/currency when active
- Marketplace and Shop booleans

Do not expose raw rights rows or non-owner ACL membership through the public
response. If future UI requires rights administration, define a separate
admin-only contract.

### Player Response

Return:

- stable public identifier suitable for keyed rendering
- display name
- block-space X/Z
- state: `online`, `recent-offline`, or `long-term-offline`
- last-seen time where appropriate

Online state is determined by matching the current server player list to
`Player.db` using the verified stable UID field. Do not treat name matching as
authoritative if UID matching is available.

Keep player X/Z as real values. `firstseen`, `lastseen`, and Area timestamps
are Unix epoch seconds in the verified source databases and must be converted
to ISO-8601 UTC at the DTO boundary.

Long-term offline rows are included only after backend authentication confirms
the current manager user has role `admin`. Anonymous/non-admin responses must
be filtered before serialization.

### Marketplace Offer Response

For one verified Marketplace `areaId`, return only active local offers needed
for display:

- stable listing ID
- item display identity and quantity
- seller display name if already public in Marketplace behavior
- price and currency
- relevant variant/quality metadata supported by the verified schema

Reject invalid area IDs and return an unavailable/empty result when the
Marketplace capability is absent. Never deserialize arbitrary plugin item
payloads without bounded validation.

## Configuration

Add one validated setting:

```text
MAP_RECENT_PLAYER_DAYS=7
MAP_PLAYERLIST_URL=http://127.0.0.1:<query-port>/playerlist
```

- integer, minimum `1`, with a documented upper bound
- controls recent versus long-term offline classification
- does not affect online detection
- `MAP_PLAYERLIST_URL` is optional but required for authoritative green online
  markers; it must point to the live Rising World `playerlist` endpoint

Prefer short TTL caches per layer over continuous background polling unless
runtime measurements prove a poller is required. Cache keys must include active
world identity and relevant authorization class.

## Layering And Implementation Checklist

- [x] Add interfaces and DTOs for capability, claim, player, and offer
  responses.
- [x] Add strict validators for path parameters and source rows.
- [x] Add dedicated read-only database access; do not expand the existing
  `RWSQLite` class into a cross-domain monolith.
- [x] Add settings parser for Land Claim colors/permissions with verified
  defaults and safe fallback behavior.
- [x] Add capability service that composes plugin inventory with actual
  settings/table compatibility.
- [x] Add claim service joining Areas/rights, Player identity, Land Claim sale
  state, Marketplace zones, and Shop zones by verified area ID.
- [x] Add Marketplace local-offer service with bounded result count and stable
  ordering.
- [x] Add player classification service using current online status plus
  `Player.db`.
- [x] Add route authorization/filtering for long-term offline players.
- [x] Add handlers/routes under the existing data-server router.
- [ ] Add TTL caching or request coalescing after measuring fixture/runtime
  query cost.
- [x] Keep missing optional resources isolated from backend startup.
- [x] Update README/API/config/CHANGELOG/PLANS documentation as required by
  repository policy.

## Validation Strategy

- [x] Fixture tests cover current, missing, empty, plugin-free, and
  incompatible core database schemas.
- [ ] Add an injected locked/busy database retry test before runtime rollout.
- [x] Area geometry and negative coordinates preserve exact verified units.
- [x] Raw Area edge noise normalizes to positive half-open 32-block multiples;
  malformed/non-rectangular rows are rejected.
- [x] Permission filtering accepts configured Land Claim permissions and
  rejects unrelated Areas.
- [x] Owner resolution follows configured `ownerAreaPermission`.
- [x] Packed plugin colors convert correctly to API RGBA/CSS values.
- [x] Only active claim sales are joined; runtime validation must cover
  production withdrawn/sold rows.
- [x] Marketplace and Shop flags join only matching positive area IDs.
- [x] Local offers use the Marketplace plugin's active zone query semantics,
  stable newest-first order, and limit 30.
- [x] Online players override offline age classification.
- [x] Threshold behavior is deterministic in UTC.
- [x] Anonymous/non-admin responses never contain long-term offline positions.
- [x] Admin responses contain long-term offline positions when available.
- [x] Existing terrain map, plugin inventory, player-list, and unrelated APIs
  remain compatible.
- [x] `yarn build`
- [x] `yarn test`
- [x] `yarn test:coverage` meets the repository's 90% global thresholds.
- [ ] Docker/runtime smoke with all optional plugin combinations.

## Risks

- Source schema drift can silently corrupt joins. Check required tables and
  columns before enabling a capability.
- Joining multiple live SQLite databases cannot be transactional. Treat each
  response as a bounded snapshot and tolerate missing enrichment.
- Player and owner data is sensitive. Minimize DTO fields, avoid raw database
  IDs where unnecessary, and enforce admin filtering in service/handler tests.
- Reading large unbounded tables per map refresh can cause I/O pressure.
  Measure, cap offers, cache briefly, and add viewport bounds only if needed.
- Backend authentication may not currently protect data-server routes. Do not
  ship the long-term offline layer until the role check is proven end to end.

## Rollback

Remove or disable the new layer routes while preserving existing schema-5 map
metadata, tile rendering, plugin inventory, and player APIs. All source
databases remain untouched.

## Current Implementation State

- Schema-1 capability, claim, player, and Marketplace-offer endpoints are
  implemented under `/api/data/server/map/layers`.
- Plugin sources are discovered by valid manifest name and opened read-only.
- Land Claim settings, owner resolution, configured colors, active sales,
  Marketplace/Shop flags, and local offers are covered by sanitized fixtures.
- Player classification supports `MAP_RECENT_PLAYER_DAYS` and optional
  authoritative online UID loading through `MAP_PLAYERLIST_URL`.
- Long-term offline rows are emitted only for verified backend admin tokens.
- Build, 97 automated tests, and global coverage thresholds pass.
- Remaining delivery gates are deployed schema compatibility, busy/locked
  SQLite behavior, live player-list UID matching, and Docker/runtime smoke.
