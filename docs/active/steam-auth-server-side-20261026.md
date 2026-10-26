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
- [x] Publish backend 0.8.0-rc.3 and frontend 1.8.0-rc.7.
- [x] Back up Production Compose and deploy backend before frontend.
- [x] Verify health, runtime images, login failure handling and public frontend assets.
- [x] Rotate the previously exposed Steam API key in the Steam account and update the backend environment value.

## Risks, validation and rollback

If Steam verification or the persona API is unavailable, sign-in rejects unverified callbacks; persona lookup failures alone keep sign-in usable with a generated name. Validate signed, tampered, stale and replayed callbacks in tests. Back up Compose, change only the two Manager services, and restore their previous image tags and environment settings if rollout verification fails. No persistence schema changes are involved.

## Deployment evidence

On 2026-10-26, Production Compose was backed up as `docker-compose.yml.bak-steam-rc7-20261026T063222Z`. `rw-be-main` and then `rw-manager` were recreated with the intended RC images. Both containers were healthy with zero restarts. The backend returned HTTP 200 for `/health`, HTTP 400 for an incomplete OpenID assertion, and HTTP 200 with a matching player for the server-side Steam profile lookup. The public server link returned the OZ metadata and a preview PNG matching the repository asset hash; the delivered JavaScript contained no direct Steam Web API reference or key placeholder. A real interactive Steam sign-in still needs a user browser check.

The user confirmed that interactive Steam sign-in succeeds without CORS errors and accepted the social preview and icons. A read-only comparison confirmed that the live backend key differs from the former frontend key and matches the current Compose setting; no secret value was printed.
