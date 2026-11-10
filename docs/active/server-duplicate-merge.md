# Server duplicate reconciliation

## Objective and ownership

Keep the earliest observed catalog ID when an admin confirms that several
master-list endpoints represented one server. `rw-manager-backend` owns the
candidate API, canonical ID aliases, import behavior, and MongoDB merge.
`devidian-rw-manager` owns the review UI.

## Constraints and decisions

- Candidates need complete name, short name, map, game mode, and OS data.
- Only the Steam super-admin may preview or merge public master-list records.
- `alternateIds` resolve old links but do not prove that a later occupant of an
  old IP address is the same server.
- The current endpoint supplies live fields; overlapping statistic hours keep
  the bucket with the highest sample count, then latest update time.
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
