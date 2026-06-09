# Admin Mapping And Plugin Inventory API

## Objective
Expose installed Rising World plugin metadata and securely serve Admin Utils map
metadata/PNG tiles to the manager frontend.

## Ownership
Owning service: `rw-manager-backend`

Supporting repositories:
- `rw-plugin-oz-admin-utils` produces the map contract.
- `devidian-rw-manager` consumes the API.

## Pre-Implementation Gate
- [ ] Review the current dirty worktree.
- [ ] Validate the existing changes with `yarn build` and `yarn test`.
- [ ] Commit all current backend changes as a separate checkpoint before
  implementing this feature.
- [ ] Verify the `strato.V80` deployment mount exposes the active server root,
  plugin directories, and generated map tiles to the backend container.

## API Contract
Add read-only data routes following existing router/handler/DTO/service layers:

```text
GET /api/data/server/plugins
GET /api/data/server/map
GET /api/data/server/map/tiles/:worldKey/:z/:x/:y.png
```

Plugin response:

```json
{
  "items": [
    {
      "directory": "OZAdminUtils",
      "name": "OZ - Admin Utils",
      "version": "0.6.0",
      "valid": true
    }
  ]
}
```

Map response when available:

```json
{
  "available": true,
  "metadata": {
    "schemaVersion": 4,
    "worldKey": "...",
    "worldName": "...",
    "tileSize": 256,
    "chunkSize": 32,
    "sectorSizeChunks": 256,
    "nativeTileSizeChunks": 8,
    "minZoom": 0,
    "nativeZoom": 8,
    "bounds": {},
    "updatedAt": "...",
    "tileUrl": "/api/data/server/map/tiles/.../{z}/{x}/{y}.png"
  }
}
```

When absent, return HTTP 200 with `{ "available": false }`. A missing tile
returns 404.

## Design Decisions
- Discover plugins under `${SERVER_ROOT}/Plugins`.
- Parse top-level `name` and `version` from each `plugin.yml`; malformed entries
  remain visible with `valid: false` and an omitted/diagnostic-safe value.
- Determine map availability only from a valid Admin Utils `metadata.json` and
  matching map root.
- Never expose physical filesystem paths.
- Resolve requested tile paths under the selected world map root and reject
  traversal, symlink escape, non-PNG extension, and invalid numeric segments.
- Return `image/png` and conservative cache headers. Metadata is no-cache or
  short-lived so newly generated sectors appear promptly.
- Remove or quarantine the experimental `src/utils/convert-tile-to-png.ts`
  before feature completion; the plugin-generated PNG contract supersedes raw
  Rising World map conversion.

## Dependencies
- Runtime: mounted Rising World server root.
- Build: evaluate a small maintained YAML parser; do not use regex-only parsing
  if plugin metadata variants require structured YAML.
- Optional integrations: frontend only.

## Risks
- Filesystem exposure/path traversal.
- Backend container lacks the plugin/map mount.
- One malformed plugin prevents inventory response.
- Cache hides freshly generated map sectors.

## Validation Strategy
- [ ] Test empty/missing Plugins directory.
- [ ] Test valid and malformed `plugin.yml` files.
- [ ] Test map absent, malformed metadata, and available metadata.
- [ ] Test existing/missing PNG tile responses and content type.
- [ ] Test traversal and symlink escape rejection.
- [ ] Test route behavior with current auth/data-service modes.
- [ ] `yarn build`
- [ ] `yarn test`
- [ ] Validate Docker deployment on `strato.V80`.

## Rollback Considerations
Remove the new routes/services. The backend must continue operating when map
files or Admin Utils are absent.

## Implementation Checklist
- [ ] Commit current backend work as the required checkpoint.
- [ ] Add plugin inventory interfaces/DTOs/service/handler/router.
- [ ] Add map metadata interfaces/DTOs/service/handler/router.
- [ ] Add secure PNG tile handler.
- [ ] Add tests and API documentation.
- [ ] Update README, CHANGELOG, and deployment documentation.
- [ ] Deploy and verify mounted filesystem access.
