# Changelog

## Unreleased

### Added

* add authenticated server-scoped live map layer WebSocket invalidations
* refresh plugin map data only while the corresponding server has subscribers

## [0.5.0](https://github.com/Devidian/rw-manager-backend/compare/rw-manager-backend-v0.4.0...rw-manager-backend-v0.5.0) (2026-07-06)


### Added

* add GPS map marker layer API ([430c9f5](https://github.com/Devidian/rw-manager-backend/commit/430c9f5273640efff6ea1a4fffa88593acf65d2e))
* add online map layer APIs ([d52c6fb](https://github.com/Devidian/rw-manager-backend/commit/d52c6fbb2a1741ad3c241c912ca93ab512c6da2e))
* plugin list & map (WIP) ([ae97b15](https://github.com/Devidian/rw-manager-backend/commit/ae97b1517efbbdb390f1bf9ca20de6fbbae6009a))
* release manager map layer updates ([e94daa9](https://github.com/Devidian/rw-manager-backend/commit/e94daa9a550d9cfe3e093e590dbbf43068945df8))
* render map tiles with semantic colors ([8edc092](https://github.com/Devidian/rw-manager-backend/commit/8edc092f06e1cbcc0beb82db0d1d57d348e724b2))


### Fixed

* compile typia transforms deterministically ([1b2d9af](https://github.com/Devidian/rw-manager-backend/commit/1b2d9af6a2b96a2f0009f0c408a1334c21ad9722))
* correct live map layer alignment ([9a94c74](https://github.com/Devidian/rw-manager-backend/commit/9a94c7407cb300766da79586df15f7f5311cdd3d))
* gh action workflow ([b0007e2](https://github.com/Devidian/rw-manager-backend/commit/b0007e204ec1b94d0ef947cddf9f4cc758b4c090))
* read plugin metadata from release jars ([f3eb3d9](https://github.com/Devidian/rw-manager-backend/commit/f3eb3d9d862b732c9be713cba8619f7402788d39))
* refine forest and arctic map colors ([2aad3d8](https://github.com/Devidian/rw-manager-backend/commit/2aad3d858a23ac8b367c7d888ae0b5cd433532e9))
* render water and LOD vegetation colors ([16b283a](https://github.com/Devidian/rw-manager-backend/commit/16b283aa12a7158f6581beefdb20fdacb45b9c81))
* startup without database ([da69222](https://github.com/Devidian/rw-manager-backend/commit/da692227f510c49cb7e321df6a69d264295961a3))
* test failed mkdir ([0857af4](https://github.com/Devidian/rw-manager-backend/commit/0857af49f92ecce81bb9c3f4a8bc77dec3f2145b))


### Changed

* agent refactoring according to AGENTS.md ([22f5314](https://github.com/Devidian/rw-manager-backend/commit/22f5314df8fdb367a25c0abcad01d6402ae43a07))


### Maintenance

* checkpoint backend repository migration ([5a178a1](https://github.com/Devidian/rw-manager-backend/commit/5a178a1b13b30f06dec6dd365b30b02e1f11ee21))
* **deps:** bump @babel/core ([1eac447](https://github.com/Devidian/rw-manager-backend/commit/1eac44788449f39fa5dea2a2e5287865cb5661c6))
* **deps:** bump @babel/core from 7.29.0 to 7.29.7 in the npm_and_yarn group across 1 directory ([102b7b7](https://github.com/Devidian/rw-manager-backend/commit/102b7b7153291628f48bcf21487c6019d7c05e11))
* **deps:** bump form-data from 4.0.5 to 4.0.6 in the npm_and_yarn group across 1 directory ([e2454eb](https://github.com/Devidian/rw-manager-backend/commit/e2454ebf7c3d6857ffb95152bc412da3ea79215c))
* **deps:** bump form-data in the npm_and_yarn group across 1 directory ([b194c33](https://github.com/Devidian/rw-manager-backend/commit/b194c338f309c4749e949827c0723f0e007c9b2b))
* **deps:** bump js-yaml from 3.14.2 to 3.15.0 in the npm_and_yarn group across 1 directory ([e7693ca](https://github.com/Devidian/rw-manager-backend/commit/e7693cad0a79f4cbe1082bb89544feb79fe1e781))
* **deps:** bump js-yaml in the npm_and_yarn group across 1 directory ([c85ddf2](https://github.com/Devidian/rw-manager-backend/commit/c85ddf2c0bd735f90686a3be04309a16d613de55))
* **deps:** bump minimatch from 3.1.2 to 3.1.5 in the npm_and_yarn group across 1 directory ([d793b12](https://github.com/Devidian/rw-manager-backend/commit/d793b12dc2810c79b5c0ff476a974b2cde9d9711))
* **deps:** bump minimatch in the npm_and_yarn group across 1 directory ([1b62baf](https://github.com/Devidian/rw-manager-backend/commit/1b62baf593413a0e804bdeb33a72d673de98c721))
* **deps:** bump the npm_and_yarn group across 1 directory with 9 updates ([59d7335](https://github.com/Devidian/rw-manager-backend/commit/59d7335c2eaa0a0f6ec7397222f904a4cb62e661))
* **deps:** bump the npm_and_yarn group across 1 directory with 9 updates ([a95c7c0](https://github.com/Devidian/rw-manager-backend/commit/a95c7c03ab1ef093e8d520313895b9089338f0f8))
* **main:** release rw-manager-backend 0.2.0 ([4906c1e](https://github.com/Devidian/rw-manager-backend/commit/4906c1e2ee28609473720d4cb5a8296617c402c5))
* **main:** release rw-manager-backend 0.2.0 ([d3406c6](https://github.com/Devidian/rw-manager-backend/commit/d3406c63b2c4803263bfdef5ef97705e581b8b8a))
* **main:** release rw-manager-backend 0.3.0 ([7c71ad0](https://github.com/Devidian/rw-manager-backend/commit/7c71ad0319788e46a098478c0a4355767a04c868))
* **main:** release rw-manager-backend 0.3.0 ([cdd3145](https://github.com/Devidian/rw-manager-backend/commit/cdd31458338b6a6e97f16b696627b01c617849c0))


### Tests

* cover backend statistics branches ([ca66b3e](https://github.com/Devidian/rw-manager-backend/commit/ca66b3efc3890eab51123db4cf0b87005aeb55e6))

## [0.3.0](https://github.com/Devidian/rw-manager-backend/compare/rw-manager-backend-v0.2.0...rw-manager-backend-v0.3.0) (2026-07-01)


### Added

* add GPS map marker layer API ([430c9f5](https://github.com/Devidian/rw-manager-backend/commit/430c9f5273640efff6ea1a4fffa88593acf65d2e))
* add online map layer APIs ([d52c6fb](https://github.com/Devidian/rw-manager-backend/commit/d52c6fbb2a1741ad3c241c912ca93ab512c6da2e))
* render map tiles with semantic colors ([8edc092](https://github.com/Devidian/rw-manager-backend/commit/8edc092f06e1cbcc0beb82db0d1d57d348e724b2))


### Fixed

* compile typia transforms deterministically ([1b2d9af](https://github.com/Devidian/rw-manager-backend/commit/1b2d9af6a2b96a2f0009f0c408a1334c21ad9722))
* correct live map layer alignment ([9a94c74](https://github.com/Devidian/rw-manager-backend/commit/9a94c7407cb300766da79586df15f7f5311cdd3d))
* read plugin metadata from release jars ([f3eb3d9](https://github.com/Devidian/rw-manager-backend/commit/f3eb3d9d862b732c9be713cba8619f7402788d39))
* refine forest and arctic map colors ([2aad3d8](https://github.com/Devidian/rw-manager-backend/commit/2aad3d858a23ac8b367c7d888ae0b5cd433532e9))
* render water and LOD vegetation colors ([16b283a](https://github.com/Devidian/rw-manager-backend/commit/16b283aa12a7158f6581beefdb20fdacb45b9c81))


### Maintenance

* **deps:** bump @babel/core ([1eac447](https://github.com/Devidian/rw-manager-backend/commit/1eac44788449f39fa5dea2a2e5287865cb5661c6))
* **deps:** bump @babel/core from 7.29.0 to 7.29.7 in the npm_and_yarn group across 1 directory ([102b7b7](https://github.com/Devidian/rw-manager-backend/commit/102b7b7153291628f48bcf21487c6019d7c05e11))
* **deps:** bump form-data from 4.0.5 to 4.0.6 in the npm_and_yarn group across 1 directory ([e2454eb](https://github.com/Devidian/rw-manager-backend/commit/e2454ebf7c3d6857ffb95152bc412da3ea79215c))
* **deps:** bump form-data in the npm_and_yarn group across 1 directory ([b194c33](https://github.com/Devidian/rw-manager-backend/commit/b194c338f309c4749e949827c0723f0e007c9b2b))
* **deps:** bump js-yaml from 3.14.2 to 3.15.0 in the npm_and_yarn group across 1 directory ([e7693ca](https://github.com/Devidian/rw-manager-backend/commit/e7693cad0a79f4cbe1082bb89544feb79fe1e781))
* **deps:** bump js-yaml in the npm_and_yarn group across 1 directory ([c85ddf2](https://github.com/Devidian/rw-manager-backend/commit/c85ddf2c0bd735f90686a3be04309a16d613de55))
* **deps:** bump the npm_and_yarn group across 1 directory with 9 updates ([59d7335](https://github.com/Devidian/rw-manager-backend/commit/59d7335c2eaa0a0f6ec7397222f904a4cb62e661))
* **deps:** bump the npm_and_yarn group across 1 directory with 9 updates ([a95c7c0](https://github.com/Devidian/rw-manager-backend/commit/a95c7c03ab1ef093e8d520313895b9089338f0f8))

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

### Fixed

* identify master-list servers by their IP and port instead of the transient
  anonymous Steam server ID, and replace the server Steam-ID index with a
  unique endpoint index.

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
* Read-only schema-1 map layer APIs for sectors, Land Claim areas, claim
  sales, Marketplace/Shop area flags, local offers, and privacy-filtered
  player positions.

### Changed

* Replaced plugin-generated schema-4 map output with backend-owned schema-5
  rendering and tile serving.
* Corrected online-map sector geometry to 256 chunks per axis, moved the
  renderer water threshold down to `Y=91`, and delegated online player status
  to each frontend server entry's existing player-list data.
* Migrated local package-manager execution from the obsolete Yarn 1 path file
  to the declared Yarn 4/Corepack baseline.
* Server list responses now include the latest cached live status fields from
  periodic query refreshes, including online status and player-list data.
