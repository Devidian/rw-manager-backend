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
- [ ] Validate the complete flow against Development MongoDB and real duplicate
  records, including the renderer and game connector.
- [ ] Take a Production backup and obtain a separate rollout decision before
  enabling the feature there.

## Validation and rollback

Run focused Jest tests and `yarn build`; run the frontend checks in its own
checkout. For a wrong merge, restore the pre-merge MongoDB backup. Reverting
the backend alone does not recreate deleted source records or statistic buckets.
