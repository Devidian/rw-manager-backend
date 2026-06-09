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
