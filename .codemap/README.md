# Rising World Manager backend
<!-- codemap-id: rw-manager-backend -->

## Purpose

Express/TypeScript REST and WebSocket service. [Startup](../src/index.ts) wires the HTTP server and live services. [Configuration](../src/utils/app-config.ts) controls runtime and MongoDB storage.

## Modules

- [REST API and persistence](modules/api.md)
- [Game data and live updates](modules/live.md)
- [Map metadata and layers](modules/maps.md)

## Build and tests

[Package scripts](../package.json) define `yarn build` and `yarn test`; [tests](../tests/) cover handlers, services and contracts.
