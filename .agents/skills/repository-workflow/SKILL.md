---
name: "repository-workflow"
description: "Use for repository-local workflows, validation, migrations, runtime debugging, and release checks in rw-manager-backend."
---
# Repository Skills

## api-contract-validation
- Review route, DTO, validator, handler, service, mapper, and persistence boundaries together.
- Keep request/response contracts explicit and typed.
- Document user-visible API changes in repository docs.

## runtime-debugging
- Reproduce with Yarn scripts before Docker validation.
- Check environment variables, Dockerfile behavior, and deployment examples when runtime behavior changes.
- Record commands and blockers in the active task.

## storage-migration-review
- Treat persistence layout or adapter changes as migrations.
- Require rollback notes, backward compatibility review, and tests or manual verification.

## release-validation
- Preserve Yarn, Docker, CI, and configured Node.js baseline.
- Check changelog/docs when behavior, deployment, or configuration changes.
- Never require workspace-root files for backend release or deployment.
