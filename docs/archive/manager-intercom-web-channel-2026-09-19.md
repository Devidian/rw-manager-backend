# Manager account presence and favorite persistence

## Objective

Persist the last successful account presence for administrative display and make
favorite removal return the document that was actually persisted.

## Ownership and affected services

- `rw-manager-backend`: user persistence, auth service, public DTO, tests.
- `devidian-rw-manager`: consumes the additive timestamp and renders it.

## Dependencies

Existing JSON and Mongo stores must accept legacy user documents without a
presence timestamp. No game-server or relay protocol change is required.

## Risks and rollback

`lastSeenAt` is optional and additive. The database operation removes only the
requested favorite ID. Rollback is image-level; no data migration is necessary.

## Validation

- [x] Cover successful authentication timestamp persistence and DTO mapping.
- [x] Cover persisted favorite removal.
- [x] Run `yarn build` and `yarn test`.
- [x] Publish and deploy the compatible Manager RC. Backend runtime acceptance
      completed with 0.7.1-rc.2 on 2026-09-24.
