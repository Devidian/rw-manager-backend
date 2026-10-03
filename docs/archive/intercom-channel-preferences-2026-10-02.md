# Intercom channel preferences

## Objective and ownership

The Manager backend owns the authenticated user preference for additional public Global Intercom channels. The Manager frontend owns the controls and WebSocket subscriptions. `rw-girs` already accepts public channel joins, so its protocol is unchanged.

## Constraints and migration

- The preference is an additive `intercomChannels` array on the user record.
- Existing records without the array map to `global` and `web`; those channels cannot be removed through the new route.
- `PATCH /api/auth/self/intercom-channels` validates the request, normalizes names, and returns the updated private user DTO.
- No new dependency or one-time database migration is required.

## Checklist and validation

- [x] Extend user storage and DTO mapping without changing old records.
- [x] Add an authenticated, validated self-update route.
- [x] Cover defaults, normalization, and invalid requests with tests.
- [x] Pass backend build and full test suite.

Rollback: revert the route and DTO changes. Persisted arrays are inert to older backend versions. Frontend consumers must deploy after a compatible backend; no production deployment was performed in this task.
