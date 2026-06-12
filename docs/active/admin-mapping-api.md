# Admin Mapping Rendering And API V2

## Objective
Replace serving of plugin-generated map files with backend-owned change
polling, rendering state, PNG tile generation, pyramid maintenance, local tile
storage, metadata, and secure tile delivery.

The existing installed-plugin inventory remains independent and unchanged.

## Ownership
Owning service: `rw-manager-backend`

The backend owns:
- discovery and read-only access to Admin Utils `[WORLDNAME].db` source data
- periodic change polling and retry behavior
- its own rendering-state database
- chunk rendering, native tile composition, and parent-pyramid rebuilding
- generated map metadata and backend-local tile storage
- secure map metadata/tile APIs

Supporting repositories:
- `rw-plugin-oz-admin-utils` owns the versioned raw source schema and writes.
- `devidian-rw-manager` consumes metadata and tiles.

## Shared Contract
The authoritative cross-repository contract is the workspace-root document
`docs/active/admin-mapping-v2-contract.md`.

The backend implements:
- read-only source table `map_chunks_v1` for the active world
- backend-owned `map_render_state_v1`
- `ENABLE_MAP_RENDERER`, `MAP_TILE_ROOT`, `MAP_RENDER_INTERVAL_MS`, and
  `MAP_RENDER_BATCH_SIZE`
- schema-5 map metadata, native zoom `8`, minimum zoom `0`, and signed
  coordinate bounds
- a backend port of the existing Admin Utils V1 texture palette
- initial pixels based on texture only; height remains hash-relevant source
  data while biome/region remain nullable metadata

Unknown source schema versions or malformed records are rejected safely without
stopping processing of other chunks.

## Source And State Databases
- Open plugin-owned `[WORLDNAME].db` databases read-only.
- Never migrate, mutate, or lock plugin-owned source tables for backend state.
- Read current source `-wal`/`-shm` companions when present; never checkpoint
  the plugin-owned database.
- Maintain the separate backend-owned rendering-state database at
  `${MAP_TILE_ROOT}/.state/rendering.db`.
- Store at least world name, chunk X/Z, rendered source hash, and last
  rendering timestamp per current chunk.
- Select candidates whose source timestamp is newer than the observed source
  timestamp in rendering state, then use hash comparison to decide whether
  rendering is required.
- Advance observed source timestamps for unchanged hashes without rewriting
  tiles. Update rendered hash/time only after all affected native and parent
  tiles have been written successfully.
- Recover pending changes after restart or partial failure.

## Rendering Contract
- One Rising World chunk is `32x32` terrain blocks.
- One terrain block renders as `4x4` pixels.
- One rendered chunk image is `128x128` pixels.
- One native PNG tile is `256x256` pixels and contains `2x2` chunks.
- Missing chunk quadrants are transparent.
- Native tile coordinates use stable world coordinates and floor division for
  negative chunks.
- Re-rendering one chunk recomposes its complete native tile from every
  available source chunk in that tile.
- Rebuild each affected ancestor exactly once per zoom through level `0`.
- Parent composition preserves available siblings and uses transparency for
  missing children.
- Write generated PNG and metadata files atomically beneath the configured
  backend-local tile root.
- Use `pngjs` as the planned pure-JavaScript PNG implementation unless an
  implementation spike proves it insufficient.

## Processing Flow
1. Periodically discover configured world source databases.
2. Select source records newer than relevant rendering state.
3. Validate and decode each source record.
4. Skip records whose source hash already matches rendering state.
5. Group changed chunks by affected native tile.
6. Render/recompose changed native tiles from current source records.
7. Rebuild affected parent tiles through zoom `0`.
8. Atomically publish files and transactionally advance rendering state.

## API Contract
Retain the public route shapes unless the finalized V2 metadata contract
requires an explicit versioned replacement:

```text
GET /api/data/server/plugins
GET /api/data/server/map
GET /api/data/server/map/tiles/:worldKey/:z/:x/:y.png
```

- `GET /api/data/server/plugins` keeps its existing behavior.
- `GET /api/data/server/map` reports availability from valid backend-owned V2
  metadata/output, never from Admin Utils `map-tiles`.
- Metadata describes the V2 `2x2`-chunk native tile geometry, zoom levels,
  bounds, update timestamp, world identity, and tile URL template.
- When no valid rendered map exists, return HTTP 200 with
  `{ "available": false }`.
- A missing tile returns 404.
- Never expose physical source, state-database, or tile-root paths.
- Resolve requested tiles beneath the configured output root and reject path
  traversal, symlink escape, invalid zoom/coordinates, and non-PNG requests.

## V1 Replacement Scope
Remove or replace:

- map availability derived from Admin Utils `metadata.json`
- tile serving rooted in plugin-generated `map-tiles`
- V1 schema-4 DTO assumptions such as `nativeTileSizeChunks=8`
- deployment assumptions requiring plugin-generated PNG directories
- obsolete experimental conversion utilities superseded by the V2 renderer

Keep plugin inventory routes and tests unless separately changed.

## Implementation Checklist
- [x] Finalize and document source, state, rendering, metadata, and environment
  contracts.
- [x] Add validated environment configuration for source discovery, rendering
  state, polling, and backend-local tile output.
- [x] Add read-only source database discovery and versioned record decoding.
- [x] Add backend-owned rendering-state database and migrations.
- [x] Add periodic candidate polling, hash comparison, retry, and recovery.
- [x] Add deterministic chunk renderer and `2x2` native tile compositor.
- [x] Add incremental parent-pyramid rebuild through zoom `0`.
- [x] Add atomic output/metadata publication.
- [x] Replace V1 map availability and tile-root behavior in services/routes.
- [x] Preserve and revalidate secure tile path handling.
- [x] Remove obsolete V1 assumptions/utilities/docs.
- [x] Update README, CHANGELOG, API, and deployment documentation.
- [x] Run build, automated tests, and provided-database runtime smoke.

## Validation Strategy
- [x] Missing/unmounted source databases do not prevent backend startup.
- [x] Valid source records decode exactly according to the shared contract.
- [x] Malformed records and unknown schema versions are isolated and reported.
- [x] New and changed hashes reach the render processor; unchanged hashes do
  not.
- [x] Timestamp changes with an unchanged hash do not invoke rendering.
- [x] One chunk renders as `128x128`; one native tile contains correct `2x2`
  chunk placement and transparent missing quadrants.
- [x] Positive and negative coordinates map to stable, correctly oriented
  tiles.
- [x] Parent rebuild preserves unchanged siblings and unrelated tiles.
- [x] Rendering state advances only after successful atomic publication.
- [x] Injected processor failure does not advance changed rendering state.
- [ ] Deployment restart reprocesses pending changes.
- [x] Tile output exists only beneath the configured backend-local root.
- [x] Map metadata reports V2 geometry/bounds and no physical paths.
- [x] Missing tiles return 404; traversal and symlink escape are rejected.
- [x] Existing plugin inventory behavior remains valid.
- [x] `yarn build`
- [x] `yarn test`
- [ ] Docker deployment smoke verifies source mounts, writable output/state
  paths, periodic rendering, and API delivery.

## Risks
- Polling by timestamp alone can miss or repeat work; combine candidate
  timestamps with hash comparison and transactional state.
- SQLite reads can contend with plugin writes; use read-only connections,
  bounded queries, compatible journal behavior, and retries.
- Partial pyramid publication can expose inconsistent zoom levels; publish
  atomically where possible and advance state last.
- A large backlog can monopolize CPU/I/O; batch work and make polling
  non-overlapping.
- Incorrect coordinate/orientation conversion can mirror the map; verify known
  landmarks and negative coordinates.
- Tile APIs can expose filesystem data; retain strict root-contained
  resolution.

## Rollback Considerations
Disable the renderer/poller and return map unavailable or temporarily serve
retained disposable V1 tiles during coordinated rollback. Backend-owned
rendering state and generated tiles are rebuildable and must not be required
for backend startup.

## Current Implementation State
- Plugin inventory is implemented and remains valid.
- V2 packages 3 and 4 are implemented: source polling, transactional rendering
  state, native/parent rendering, atomic schema-5 output, secure API cutover,
  and opt-in runtime startup.
- The decoder successfully read all 9 chunks from the provided `New World.db`
  runtime copy, including its WAL-backed source state.
- Rendering the provided 9 chunks produced 4 native tiles and the complete
  affected pyramid in approximately `179 ms`.
- The reproducible `smoke:map-render` command renders a provided source copy,
  validates schema-5/native output, reopens source and state, and confirms
  `0` restart candidates for already rendered rows.
- Missing Rising World roots, `server.properties`, worlds, player databases,
  plugin directories, and Admin Utils map sources are treated as optional
  unavailable capabilities and do not prevent backend startup.
- The unavailable V1 palette source was replaced by a stable semantic palette
  derived from the client `definitions.db` natural, wood, and stone texture
  groups. The provided 9-chunk runtime copy renders plausible desert terrain
  and wood colors; broader biome fidelity remains a rollout validation
- Renderer output hashes include a renderer version so palette changes rebuild
  existing source chunks once after deployment.
- Terrain at or below the Rising World sea level `Y=92` renders as water.
- Observed LOD surface texture IDs `100` through `112` use vegetation colors;
  they are not interpreted as same-numbered construction materials.
  item.
