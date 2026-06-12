# Changelog

## [0.2.0](https://github.com/Devidian/rw-manager-backend/compare/rw-manager-backend-v0.1.0...rw-manager-backend-v0.2.0) (2026-06-12)


### Added

* plugin list & map (WIP) ([ae97b15](https://github.com/Devidian/rw-manager-backend/commit/ae97b1517efbbdb390f1bf9ca20de6fbbae6009a))


### Fixed

* gh action workflow ([b0007e2](https://github.com/Devidian/rw-manager-backend/commit/b0007e204ec1b94d0ef947cddf9f4cc758b4c090))
* startup without database ([da69222](https://github.com/Devidian/rw-manager-backend/commit/da692227f510c49cb7e321df6a69d264295961a3))
* test failed mkdir ([0857af4](https://github.com/Devidian/rw-manager-backend/commit/0857af49f92ecce81bb9c3f4a8bc77dec3f2145b))


### Changed

* agent refactoring according to AGENTS.md ([22f5314](https://github.com/Devidian/rw-manager-backend/commit/22f5314df8fdb367a25c0abcad01d6402ae43a07))


### Maintenance

* checkpoint backend repository migration ([5a178a1](https://github.com/Devidian/rw-manager-backend/commit/5a178a1b13b30f06dec6dd365b30b02e1f11ee21))
* **deps:** bump minimatch from 3.1.2 to 3.1.5 in the npm_and_yarn group across 1 directory ([d793b12](https://github.com/Devidian/rw-manager-backend/commit/d793b12dc2810c79b5c0ff476a974b2cde9d9711))
* **deps:** bump minimatch in the npm_and_yarn group across 1 directory ([1b62baf](https://github.com/Devidian/rw-manager-backend/commit/1b62baf593413a0e804bdeb33a72d673de98c721))

## Changelog

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
