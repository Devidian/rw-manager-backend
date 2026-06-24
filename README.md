# rw-manager-backend

Backend API for Rising World server management with TypeScript, Express 5, lowdb, and SQLite integration.

## Server Data API

When `ENABLE_DATA=true`, the backend exposes read-only server data including:

```text
GET /api/data/server/plugins
GET /api/data/server/map
GET /api/data/server/map/tiles/:worldKey/:z/:x/:y.png
GET /api/data/server/map/layers
GET /api/data/server/map/layers/claims
GET /api/data/server/map/layers/players
GET /api/data/server/map/layers/marketplaces/:areaId/offers
```

The opt-in map renderer reads Admin Utils `map_chunks_v1` records from the
active world database beneath `SERVER_ROOT`, publishes schema-5 PNG tiles
beneath the writable absolute `MAP_TILE_ROOT`, and serves only that
backend-owned output.

The backend does not require a Rising World installation to start. Missing
server configuration, worlds, player database, plugin directory, or Admin
Utils map source disable only the corresponding optional data and rendering
features.

```text
ENABLE_MAP_RENDERER=false
MAP_TILE_ROOT=/appdata/rwman/map-tiles
MAP_RENDER_INTERVAL_MS=30000
MAP_RENDER_BATCH_SIZE=256
MAP_RECENT_PLAYER_DAYS=7
```

## Storage Server List

When `ENABLE_STORAGE=true`, the backend refreshes the public Rising World
master server list and stores the merged server records under
`APP_DATA_ROOT/data.json`. The master-list `steamid` is used as the stable
server id for imported servers. Imported records keep compatibility fields
such as `queryUrl` and `backendUrl`, while exposing the new `mapUrl`,
`adminUid`, `firstSeen`, `lastSeen`, `data`, and `info` fields.

```text
MASTER_SERVER_LIST_URL=https://api.rising-world.net/v5/serverlist
MASTER_SERVER_LIST_REFRESH_INTERVAL_MS=300000
SERVER_QUERY_REFRESH_INTERVAL_MS=86400000
```

The backend derives `queryUrl` as `http://<ip>:<port - 1>`. Query `data` and
`info` are refreshed automatically no more often than
`SERVER_QUERY_REFRESH_INTERVAL_MS`. If `info.contact` is a valid Steam ID it is
stored as `adminUid`. During the transition, `@mapUrl:[url]` inside
`info.description` is stored as `mapUrl`.

Authenticated users can pin and unpin servers:

```text
POST /api/storage/server/:id/pin
DELETE /api/storage/server/:id/pin
```

Superadmins can force-refresh stored query `data` and `info`:

```text
POST /api/storage/server/refresh-query-data
```

Map layer APIs discover Land Claim, Marketplace, and Shop by their valid
plugin manifests, then read the active world's game/plugin SQLite databases
read-only. Online status is joined in the frontend from each configured
server's existing `playerlist` response.

Validate a built renderer against a copied Admin Utils world database before
enabling it:

```text
yarn build
yarn smoke:map-render -- "/path/to/New World.db"
```

## Runtime Baseline

* Node.js 24 LTS
* Yarn 4 with the `node-modules` linker
* Docker image as the primary deployment target

## Docker Compose Examples

### Minimal local or single-host deployment

```yml
services:
  app:
    image: devidian/rw-manager-backend:latest
    container_name: rw-manager-backend
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      APP_DATA_ROOT: /appdata/rwman
      SERVER_ROOT: /appdata/rising-world/dedicated-server
      ENABLE_DATA: true
      ENABLE_MAP_RENDERER: false
      MAP_TILE_ROOT: /appdata/rwman/map-tiles
      ENABLE_STORAGE: true
      ENABLE_AUTH: false
      FORCE_AUTH: false
      ENABLE_LOG_COLORS: true
      LOG_STYLE: detailed
    volumes:
      - ./app-data:/appdata/rwman
      - ./data:/appdata/rising-world/dedicated-server
      - ./cert:/app/cert
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 15s
```

### Auth-enabled deployment behind a reverse proxy

```yml
services:
  app:
    image: devidian/rw-manager-backend:latest
    container_name: rw-manager-backend-prod
    environment:
      NODE_ENV: production
      APP_DATA_ROOT: /appdata/rwman
      SERVER_ROOT: /appdata/rising-world/dedicated-server
      ENABLE_DATA: true
      ENABLE_MAP_RENDERER: false
      MAP_TILE_ROOT: /appdata/rwman/map-tiles
      ENABLE_STORAGE: true
      ENABLE_AUTH: true
      FORCE_AUTH: true
      DEFAULT_USER_ROLE: user
      AUTH_SESSION_SECRET: change-me
      SUPER_ADMIN_ID: ""
      ENABLE_LOG_COLORS: true
      LOG_STYLE: detailed
    expose:
      - "3000"
    volumes:
      - ./app-data:/appdata/rwman
      - ./data:/appdata/rising-world/dedicated-server
      - ./cert:/app/cert
    restart: always
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"]
      interval: 5s
      timeout: 3s
      retries: 5
      start_period: 15s

  nginx:
    image: nginx:stable
    container_name: rw-manager-backend-proxy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certbot/www:/var/www/certbot
      - ./certbot/conf:/etc/letsencrypt
    depends_on:
      app:
        condition: service_healthy
    restart: always
```

## Notes

* Application data is stored under `APP_DATA_ROOT`. It defaults to `./data`
  outside containers and `/appdata/rwman` in the published Docker image.
* The complete Rising World dedicated server root is expected at `SERVER_ROOT`;
  mounting only selected world data does not expose plugin inventory or maps.
* Ignored local deployment files are intentionally not treated as maintained repository examples.
