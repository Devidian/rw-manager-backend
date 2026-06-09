# Repository Policy

## Runtime Policy
- Use the repository-configured Node.js LTS baseline.
- Use Yarn and preserve the `node-modules` linker unless a migration is explicitly requested.
- Runtime changes must update `package.json`, Docker, CI, and docs together.

## Architecture Policy
- Keep routing, handling, validation, service logic, mapping, persistence, and utilities separated.
- Do not put business logic in routers or handlers.
- Keep reusable interfaces in `src/interfaces`.
- Keep TypeScript file names in kebab-case.

## Dependency Policy
- Add dependencies only when they are necessary, maintained, and compatible with the runtime.
- Do not introduce npm, pnpm, or alternate package-manager lock files.

## API Verification Policy
- Treat REST route and DTO changes as public contract changes.
- Validate request/response types, tests, and documentation together.

## Release Policy
- Preserve Docker and CI release behavior.
- Deployment-impacting changes require README and changelog updates when applicable.

## Documentation Policy
- `PLANS.md` stays intentionally minimal and links to `docs/active/`, `docs/roadmaps/`, and `docs/phase-archive.md`.
- Active tasks belong in `docs/active/`.
- Large plans and roadmaps belong in `docs/roadmaps/`.
- Completed work is summarized in `docs/phase-archive.md`.
- Planning documents must include objective, ownership, dependencies, risks, validation strategy, affected repositories/services, rollback considerations, and checkbox progress.
