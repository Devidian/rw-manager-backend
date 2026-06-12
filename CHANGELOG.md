# Changelog

All notable changes to this project will be documented in this file.

The format follows Common Changelog principles and the project uses Semantic Versioning.

## Unreleased

### Added

* Project-level agent rules aligned with the current TypeScript, Docker, Yarn, and release workflow.
* GitHub Actions workflows for CI, release PR automation, and Docker Hub publishing.
* A project-specific multi-agent configuration for architecture, API, persistence, testing, and release tasks.
* Jest ESM test configuration for the existing TypeScript test setup.
* Planning rules for agents in `PLANS.md`.
* Stronger documentation governance for `README.md` and Docker Compose examples.
* A minimum automated test coverage rule of 90 percent.
* CI parity with the Docker build by running the Typia setup step before build and test execution.
* A generated Jest test suite for the current service, db, mapper, and utility code paths with enforced coverage above 90 percent.
* Read-only plugin inventory and secure PNG tile routes under
  `/api/data/server`.
* Opt-in schema-5 map renderer with read-only Admin Utils source polling,
  backend-owned rendering state, native `2x2` chunk tiles, incremental parent
  pyramid, and atomic backend-local output.

### Changed

* Replaced plugin-generated schema-4 map output with backend-owned schema-5
  rendering and tile serving.
* Migrated local package-manager execution from the obsolete Yarn 1 path file
  to the declared Yarn 4/Corepack baseline.
