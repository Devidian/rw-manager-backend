# rw-manager-backend

Backend API for Rising World server management with TypeScript, Express 5,
MongoDB/lowdb storage, and plugin-route cache integration.

## Server Data API

When `ENABLE_DATA=true`, the backend exposes read-only server data including:

```text
GET /api/data/server/plugins
GET /api/data/server/map
GET /api/data/server/map/layers
GET /api/data/server/map/layers/claims
GET /api/data/server/map/layers/players
GET /api/data/server/map/layers/marketplaces/:areaId/offers
```

Map tile rendering is owned by `rw-map-rendering`. The manager backend reads
external renderer metadata from `MAP_TILE_ROOT/<MAP_SERVER_ID>/metadata.json`
and publishes tile URLs with `MAP_TILE_ROOT_URL` when configured.

The backend does not require a Rising World installation to start. Missing
plugin-route cache data disables only the corresponding optional data features.

```text
MAP_TILE_ROOT=/appdata/rwman/map-tiles
MAP_TILE_ROOT_URL=https://tiles.example.com/maps
MAP_SERVER_ID=server-f8e7fa9ca73fd4b4943db61a
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
LIVE_QUERY_PROXY_CACHE_TTL_MS=5000
LIVE_QUERY_PROXY_TIMEOUT_MS=8000
MAX_PINNED_SERVERS=50
SERVER_LIVE_MAX_SERVER_IDS=100
```

MongoDB is the preferred manager storage backend. When `MONGODB_URI` is set,
the backend bootstraps MongoDB collections and unique indexes for servers,
users, and statistics while keeping MongoDB `_id` values internal. If the
MongoDB collections are empty, existing JSON fallback data from
`APP_DATA_ROOT/data.json` is copied into MongoDB once during bootstrap. When the
variable is missing or the server is unreachable, the backend logs a warning
and keeps using the JSON database fallback under `APP_DATA_ROOT`.

```text
MONGODB_URI=mongodb://rwmanager:rwmanager-dev-password@mongodb:27017/rw-manager?replicaSet=rs0&authSource=admin
MONGODB_DATABASE=rw-manager
MONGODB_CONNECT_TIMEOUT_MS=5000
```

For local Change Stream compatible tests, use the minimal replica-set example.
The backend should use the URI above when it runs in the same Compose network.
Set `MONGODB_PORT` when the host port `27017` is already occupied.

```text
docker compose -f deployment-example.local/docker-compose.mongodb-replicaset.yml up -d
MONGODB_PORT=27018 docker compose -f deployment-example.local/docker-compose.mongodb-replicaset.yml up -d
```

The backend derives `queryUrl` as `http://<ip>:<port - 1>`. Query `data` and
`info` are refreshed automatically no more often than
`SERVER_QUERY_REFRESH_INTERVAL_MS`. If `info.contact` is a valid Steam ID it is
stored as `adminUid`. During the transition, `@mapUrl:[url]` inside
`info.description` is stored as `mapUrl`.

The frontend must not call the HTTP-only Rising World query server directly
from an HTTPS deployment. Live status requests are proxied through the manager
backend and cached briefly per server:

```text
GET /api/storage/server/:id/live
```

Dashboard clients use one WebSocket instead of polling this route per server:

```text
WS /api/storage/server-live
```

The first frame subscribes with `server.status.subscribe`; later
`server.status.set-servers` frames replace the complete dashboard server set
without reconnecting. The backend sends an initial `server.status.snapshot`
and then `server.status.changed` field deltas. REST remains available for
manual refresh and fallback. `MAX_PINNED_SERVERS` is the authoritative account
favorite limit (default `50`) exposed by `GET /api/` for the frontend.
`SERVER_LIVE_MAX_SERVER_IDS` independently bounds favorites plus administered
servers on one socket (default `100`, never lower than the favorite limit).

This route fetches `queryUrl`, `queryUrl + /info`, and
`queryUrl + /playerlist` server-side, coalesces concurrent requests, and uses
`LIVE_QUERY_PROXY_CACHE_TTL_MS` to avoid repeated load when multiple users open
the same server page or list. Periodic query refreshes store the same live
fields (`status`, `queryData`, `infoData`, `onlinePlayers`, `lastChecked`, and
`errorMessage`) on the server record, so `GET /api/storage/server` can include
the latest known status without triggering another live request.

Every non-cached live status check records one hourly statistics sample. The
statistics API returns hourly buckets with sample count, average players,
maximum players, and availability:

```text
GET /api/storage/server/:id/statistics
GET /api/storage/server/:id/statistics?from=2026-06-25T00:00:00.000Z&to=2026-06-26T00:00:00.000Z
```

Authenticated users can pin and unpin servers:

```text
POST /api/storage/server/:id/pin
DELETE /api/storage/server/:id/pin
```

Superadmins can force-refresh stored query `data` and `info`:

```text
POST /api/storage/server/refresh-query-data
```

Map layer APIs prefer cached plugin-route data. Transitional local SQLite
fallbacks remain only for migration parity checks.

While a frontend map is open it connects to the authenticated, server-scoped
WebSocket endpoint below. The first client frame selects exactly one server;
the backend then refreshes only servers with active subscribers and emits
changed map entities as `upserted`/`removedIds` deltas. REST map routes supply
the initial state and remain the fallback when WebSocket upgrades are
unavailable. The backend sends protocol ping frames to keep healthy proxied
connections alive and removes peers that stop answering with pong frames.

```text
WS /api/storage/map-live
MAP_LIVE_REFRESH_INTERVAL_MS=2000
```

Reverse proxies must forward HTTP Upgrade and Connection headers for this
path. `FORCE_AUTH=true` requires the existing bearer token in the initial
subscription frame; tokens are never placed in the WebSocket URL.

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
      ENABLE_DATA: true
      MAP_TILE_ROOT: /appdata/rwman/map-tiles
      MAP_TILE_ROOT_URL: https://tiles.example.com/maps
      ENABLE_STORAGE: true
      ENABLE_AUTH: false
      FORCE_AUTH: false
      ENABLE_LOG_COLORS: true
      LOG_STYLE: detailed
    volumes:
      - ./app-data:/appdata/rwman
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
      ENABLE_DATA: true
      MAP_TILE_ROOT: /appdata/rwman/map-tiles
      MAP_TILE_ROOT_URL: https://tiles.example.com/maps
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
