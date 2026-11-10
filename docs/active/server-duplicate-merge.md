# Server duplicate reconciliation

## Objective and ownership

Keep the earliest observed catalog ID when an admin confirms that several
master-list endpoints represented one server. `rw-manager-backend` owns the
candidate API, canonical ID aliases, import behavior, and MongoDB merge.
`devidian-rw-manager` owns the review UI.

## Constraints and decisions

- Candidates need complete name, short name, map, game mode, and OS data.
- Hide default-named records and candidate groups with no currently online
  instance. Keep rich name tags for display in the frontend.
- Only the Steam super-admin may preview or merge public master-list records.
- `alternateIds` resolve old links but do not prove that a later occupant of an
  old IP address is the same server.
- The current endpoint supplies live fields; overlapping statistic hours keep
  the strongest online evidence, while retaining player IDs from all buckets.
- A MongoDB transaction is required for a merge. Back up before Production use.

## Checklist

- [x] Add candidate matching, preview, merge, alias resolution, and import rules.
- [x] Keep pinned stale catalog entries available for reconciliation.
- [x] Cover matching, import identity, pins, history collision, and permissions.
- [x] Pass 49 suites, 228 tests, coverage gate, build and GitHub CI; publish
  `v0.9.0-rc.1` and deploy backend before frontend to the authorized public
  Manager instance.
- [x] Back up the public MongoDB and Compose before rollout; verify MongoDB
  replica-set status, container health, restart count and protected API route.
- [ ] Review real candidate groups and a confirmed merge in the browser,
  including renderer and game connector behavior after the first merge.

## Validation and rollback

Run focused Jest tests and `yarn build`; run the frontend checks in its own
checkout. For a wrong merge, restore the pre-merge MongoDB backup. Reverting
the backend alone does not recreate deleted source records or statistic buckets.

## RC deployment evidence (2026-11-10)

- Commit `e989726f3a6ea71ae8286c34f32051938a97662e`; CI run `42784969840`
  and Docker Publish run `42785156396` succeeded.
- Public Manager backend image `devidian/rw-manager-backend:0.9.0-rc.1`
  resolved to `sha256:8ac6fbf2d35426c225867a6edd56f4a21661a0d30e38bf9dda8148c2810462fa`.
- `rw-manager-backend-prod` on `strato.V80` is healthy with zero restarts;
  internal `/health` returned 200 and unauthenticated duplicate API returned 401.
- MongoDB archive: `/docker/apps/private/backups/rw-manager.pre-manager-duplicates-rc.20261110T084709Z.archive.gz`,
  SHA-256 `cb014785735a64adb0a2a62a38bb061891c50ea2cb591065b570e07ea07e2047`;
  Compose backup has the same timestamp. The archive passed `gzip -t`.

## Follow-up correction

- A live merge of `server-bde398bff6ffa12d58aa4b01` exposed that selecting
  the largest bucket favored stale offline endpoints. The pre-merge backup
  contains 4,575 buckets across 20 IDs; 430 of 450 distinct hours have online
  evidence. The RC.1 result retained only 41 online samples.
- Select the highest online availability per hour, retain observed player UIDs,
  and record future alias requests under the canonical ID.
- Recover this one confirmed merge from the pre-merge backup with
  `scripts/repair-merged-server-statistics-20261110.js`. Preview first, create
  a fresh backup, apply in a transaction, then verify hour and alias counts.
- Six removed source records were recreated by a long-running refresh that had
  loaded them before the merge. Existing snapshots now save without upsert;
  clean up these confirmed alias records after deploying backend RC.3. The same
  refresh emitted further alias samples, so rerun the statistics repair before
  removing those records.

## RC.3 acceptance evidence (2026-11-10)

- Backend `v0.9.0-rc.3` (`4497934`) passed 50 suites/235 tests, coverage and
  GitHub CI; Docker Publish succeeded. Public digest:
  `sha256:24034bf2c31b37bf6b732adb0c79c73ee7f0f2223c3dc9bebf5a56ebe4863490`.
- Fresh backup before alias cleanup:
  `/docker/apps/private/backups/rw-manager.pre-alias-cleanup.20261110T141939Z.archive.gz`
  (SHA-256 `40b4919ce5592b9e5d6bae15a7bb57d7c15d0c5de51e9e3a51efccc02740b56b`);
  Compose backup has the same timestamp. Archive passed `gzip -t`.
- On `strato.V80`, backend RC.3 and frontend RC.2 are healthy with zero restarts.
  The corrected history has 455 hours, 436 with online evidence, and one
  distinct observed player UID. Six stale alias records were removed after
  confirming no pinned users or remaining alias statistic buckets.
- Public old-ID statistics resolve to the canonical ID with 455 buckets;
  duplicate page returned 200 and unauthenticated duplicate API returned 401.
- The cleanup script on `main` was corrected after the RC.3 tag for a mongosh
  optional-chaining incompatibility; the corrected script was previewed and
  applied successfully. The RC.3 runtime image is unaffected.
