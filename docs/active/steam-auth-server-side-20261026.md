# Steam authentication and persona lookup

## Objective and ownership

Move the Steam Web API request and key out of the browser. The Manager backend owns Steam OpenID verification and the optional persona lookup; the Manager frontend only starts the redirect and forwards the callback parameters.

## Constraints and dependencies

- Keep the existing `/api/auth/steam` contract and generated-name fallback.
- Configure `STEAM_API_KEY` and `STEAM_OPENID_RETURN_ORIGIN` on the backend before deploying the frontend update.
- Remove `STEAM_API_KEY` from the frontend container after the backend is healthy.
- A previously exposed Steam API key needs rotation in Steam's account settings; deployment alone cannot revoke it.

## Checklist

- [x] Add server-side persona lookup and signed OpenID verification with nonce replay protection.
- [x] Remove the browser-side Steam API call and key injection.
- [x] Run backend and frontend validation.
- [ ] Publish matching RCs.
- [ ] Back up Production Compose and deploy backend before frontend.
- [ ] Verify health, runtime images, login failure handling and public frontend assets.

## Risks, validation and rollback

If Steam verification or the persona API is unavailable, sign-in rejects unverified callbacks; persona lookup failures alone keep sign-in usable with a generated name. Validate signed, tampered, stale and replayed callbacks in tests. Back up Compose, change only the two Manager services, and restore their previous image tags and environment settings if rollout verification fails. No persistence schema changes are involved.
