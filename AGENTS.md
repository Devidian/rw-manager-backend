# AGENTS.md

## Repository Purpose
This repository owns the Rising World manager backend.

It is a standalone TypeScript/Express service and must not depend on workspace-root orchestration files for development, validation, release, or deployment.

## Ownership
Owns:
- REST API behavior
- Express routing, handlers, DTOs, validation, services, mappers, and database adapters
- Docker deployment behavior for the backend
- backend runtime, persistence, and test coverage rules

Does not own:
- in-game Rising World plugin behavior
- frontend UI workflows
- workspace-root orchestration rules

## Mandatory Workflow Rules
- Use Yarn, not npm or pnpm.
- Preserve the configured Node.js LTS baseline and keep `package.json`, Docker, CI, and docs aligned when runtime changes.
- Preserve the existing source layering: router, handler, DTO, validator, service, mapper, database adapter, interfaces, utils.
- Keep TypeScript files in kebab-case.
- Follow `.codex/agents.toml` for local agent roles, task classes, context loading, and escalation.
- Follow `docs/policies/repository-policy.md` for reusable governance rules.
- Keep `README.md`, `CHANGELOG.md` when present, and `PLANS.md` aligned with behavior or structure changes.

## Validation
- Run `yarn build` for build-impacting changes.
- Run `yarn test` when tests are present or behavior changes.
- Review Docker and CI when runtime, packaging, or deployment behavior changes.
