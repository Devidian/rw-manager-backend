# City and Leasehold Map Colors

## Objective

Expose the configured Land Claim city-core and leasehold colors through the
existing map-layer contract so the Manager frontend renders the new zones.

## Ownership and dependencies

- Backend: `rw-manager-backend` maps Admin Utils world-area settings.
- Frontend: `devidian-rw-manager` already renders the returned colors.
- Dependency: Land Claim `0.15.0` settings and special permissions.

## Risks and rollback

- City leasehold occupancy is inferred from the existing area owner identity.
- Existing sale and renew-zone color precedence remains unchanged.
- Roll back by redeploying the preceding backend image.

## Validation

- [ ] Add map-layer coverage for core, available leasehold, and occupied leasehold colors.
- [ ] Run backend tests and build.
- [ ] Publish matching RC images and verify the Dev map response.
- [x] Keep RC publication isolated from stable Docker tags.
