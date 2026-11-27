# PLANS.md

- [x] Refresh every master-list `/info` contact and name, keep unapproved contacts in memory, and use `/info.name` as the catalog label.
- [ ] Confirm both contact-owned servers and approval after signed-in V30 acceptance.

Planning is stored in repository-local docs.
Satellite map metadata and cached player-server history are implemented; live satellite image ingestion remains external to this service.
Steam OpenID verification and server-side persona lookup are tracked in [docs/active/steam-auth-server-side-20261026.md](docs/active/steam-auth-server-side-20261026.md).
Server duplicate reconciliation and Development acceptance are tracked in [docs/active/server-duplicate-merge.md](docs/active/server-duplicate-merge.md).
Player identity migration and privacy acceptance are tracked in [docs/active/player-identity-steam-privacy.md](docs/active/player-identity-steam-privacy.md).
Manager guest access and Steam eligibility are tracked in the root DSGVO implementation plan; API and runtime acceptance remain open.

- [x] Remove the Steam ID masking import cycle. Verify guest and admin projection, cold module loading, and the full WebSocket suite.
- [x] Handle a connected server's targeted consent-revocation event and purge matching identities/statistics.
- [ ] Validate connected revocation, disconnect/reconnect reconciliation, and player views on Development.

- Active implementation tasks: [docs/active/](docs/active/)
- Roadmaps and larger plans: [docs/roadmaps/](docs/roadmaps/)
- Completed phase summaries: [docs/phase-archive.md](docs/phase-archive.md)
- Planning and documentation standards: [docs/policies/repository-policy.md](docs/policies/repository-policy.md)

Every implementation plan must include objective, ownership, dependencies, risks, validation strategy, affected repositories/services, rollback considerations, and a markdown checkbox checklist.
