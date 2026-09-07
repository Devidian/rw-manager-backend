# Native plugin version compatibility

## Objective and ownership
Manager backend must preserve plain native plugin versions and legacy manifest versions.
Only this backend changes; the frontend already displays the returned version.
No new dependencies, public DTO changes, install requirements or storage migration.

## Evidence and decisions (2026-09-07)
The reported public `/pluginlist` returned 13 plugins with plain string versions.
The parser previously extracted only `Version:` lines from manifests.
Accept numeric release strings, optional v prefix and prerelease/build suffixes;
retain legacy extraction and undefined for missing or invalid data.
Normal cache refresh replaces previously missing versions; no cache reset required.

## Checklist
- [x] Read the reported endpoint and trace backend parser and frontend fallback.
- [x] Implement compatibility parsing and plain/missing/legacy regression cases.
- [x] Add regression for refreshing an entry whose version was previously missing.
- [x] Build and run backend tests (initial run: 42 suites, 186 tests passed).
- [ ] Verify website after a separately authorized rollout and normal cache refresh.

## Validation, risks and rollback
Final targeted run: 2 suites, 17 tests passed, including cache replacement.
The built parser preserved all 13 versions from the captured live response.
Diff whitespace checks passed. No deployed behavior is claimed.
Revert parser and tests to roll back; stored schema and API remain unchanged.
