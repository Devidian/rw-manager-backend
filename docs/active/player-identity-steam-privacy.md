# Player identity and Steam profile privacy

## Objective and ownership

The backend owns durable `player_mappings`, the Steam visibility scheduler, player API projection, and history authorization. The Manager frontend owns ObjectId navigation and player joins. No game plugin change is required.

## Constraints and dependencies

- MongoDB is required in storage mode. Keep UID fields internally until Development acceptance and a separately approved cleanup.
- The Steam Web API key remains server side. `GetPlayerSummaries` checks at most 100 IDs per request. A missing or failed Steam result must not disclose an unchecked player's name or UID.
- A fresh native Admin Utils admin list grants only server scoped player identity. A Steam ID supplied at local registration is unverified until Steam OpenID succeeds.
- Existing `users.steamId` and server admin UIDs remain for authentication and game administration.

## Checklist

- [x] Add unique mapping IDs, unique UIDs, and repeatable references for stored players and statistic buckets.
- [x] Track confirmed online observations and check active Steam profiles hourly.
- [x] Project REST and both browser WebSocket channels; protect private profile history by verified Steam identity.
- [x] Change frontend joins and profile routes to ObjectIds.
- [x] Build and run local behavior tests.
- [x] Back up the target MongoDB database and Compose configuration before a runtime migration; record counts of servers, known players, online snapshots, buckets, and mappings.
- [x] Deploy additive backend to the explicitly authorized public V80 RC; verify reference counts, indexes, guest masking and live Steam responses.
- [x] Deploy matching frontend RC to V80 and verify health and guest REST responses.
- [ ] Obtain signed-in player and own/foreign server-admin acceptance for profile history, lists, map and live transitions.
- [ ] Remove internal UID references only after acceptance in a separate change.

## Migration, rollback, and validation

Bootstrap creates `player_mappings` and fills `playerMappingId` in stored server player rows and `onlinePlayerIds` in statistic buckets. Re-running bootstrap revisits rows safely. It retains old UID fields for comparison and rollback. Before the first runtime start, create a MongoDB backup and save the Compose definition. After migration, compare distinct stable UIDs with mappings and compare each referenced ID with `player_mappings._id`; check all private player surfaces as guest, ordinary user, own server admin, and foreign server admin. Rollback uses the pre-migration backend and database backup together. Do not deploy the old backend against migrated data without checking its write behavior.

With `MONGODB_URI` and `MONGODB_DATABASE` supplied through the deployment environment, run `node scripts/audit-player-mappings.mjs` before and after the runtime migration. The script prints counts without names or UIDs. After migration, `unmappedUids`, `orphanedReferences`, `missingPlayerRefs`, `wrongPlayerRefs`, `missingStatisticRefs`, and `wrongStatisticRefs` should be zero, excluding legacy slot-derived UIDs that the script ignores.

Risk: the startup scan touches every server and statistic bucket; a large database may lengthen startup. Steam outages preserve the last confirmed status. An individual missing profile is anonymized after six hours of repeated successful API responses.

## V80 RC evidence (2026-11-14)

The user explicitly authorized the public V80 Manager as the RC target. Before deployment, `/docker/apps/private/backups/docker-compose.yml.pre-player-identity-rc.20261114T005704Z` (SHA-256 `dd156c620f2c66ca7949fd703a2b1af5e5ae70ee8998deda94705a5f1fbc1f97`) and `/docker/apps/private/backups/rw-manager.pre-player-identity-rc.20261114T005704Z.archive.gz` (SHA-256 `4d7063b1c32b810d03b6db3623d9a76eedcf606818f2fe19cc716ea63e563e16`) were saved; `gzip -t` passed. The initial audit found 373 servers, 2,628 known player rows, 16 online rows, 1,207,413 statistic buckets, 1,477 distinct stable UIDs and no mappings.

The locally built images are `devidian/rw-manager-backend:0.9.2-identity-rc.local` (`sha256:4a8834b0f0169b79c795bb894fe06a524ffe0e7923d1f491438f9282780f2cb9`) and `devidian/rw-manager-frontend:1.9.2-identity-rc.local` (`sha256:805cae6560e5bf7b4b011203aaccd01f7895c90ed6e1851c6dfb50631b229763`). The only semantic Compose changes are these two image lines; `docker compose config --quiet` passed. Both containers were healthy with zero restarts. The post-migration audit found 1,477 mappings and zero unmapped UIDs, missing/wrong player or statistic references, and orphaned references. During the RC check, 1,459 of 1,462 Steam IDs had a successful profile check, 385 were private, and no general Steam outage was recorded.

Guest checks: `/` and `/api/storage/server` returned 200; the prior UID history URL returned 401. The server list had 16 mapped online rows, 5 private markers and zero raw 17-digit player UIDs. A server player response had private markers and zero raw Steam IDs. A 24-hour global statistic response had 9,202 buckets, 110 ObjectId player IDs, 43 private markers, no raw Steam IDs and no internal `onlinePlayerUids` field. Browser automation was unavailable because the Playwright CLI package was not cached in the restricted local environment; authenticated player/admin acceptance and a manual map/live check remain open. Stable publication and further production rollout remain separate steps.
