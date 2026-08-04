# Deep production reliability hardening

This branch keeps the hosted UI/Capacitor shell architecture, but makes the
contracts around it explicit:

- Vercel server code reads only `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and
  `SUPABASE_SERVICE_ROLE_KEY`. `VITE_*` values are client configuration and
  are never server fallbacks.
- Production CORS uses exact origins. Localhost is development-only and
  preview origins must be supplied as an explicit exact-origin list.
- `/api/status` is public liveness only. Authenticated `/api/status/ready`
  returns provider readiness for the app.
- `/api/subscription/status` is a read-only authenticated route; purchase
  mutation is kept at `/api/subscription/native-sync`.
- Every API request receives a client request ID and every API response gets a
  contract version, request ID, JSON content type, and no-store policy from the
  shared CORS boundary.
- Account deletion calls a service-role-only database cleanup function before
  deleting the Supabase Auth user.
- Daily notifications are disabled by default. Permission is requested only
  from the user's explicit settings toggle, and the preference is scoped to
  the account.

## Remote Android shell safety

The APK packages only an emergency shell and points production to the exact
HTTPS Vercel origin. `verify:native-shell` rejects a full Vite bundle in the
APK, while `NativeRuntimePlugin` reports the installed APK bridge/build values
instead of hosted JavaScript values. A confirmed old bridge shows Update
Required; a plugin timeout shows a separate retryable infrastructure screen.

Production UI releases should be promoted through the Vercel production
deployment only. A failed deployment must leave the previous READY deployment
serving the production domain; do not point `CAPACITOR_PRODUCTION_URL` at a
Preview origin. If a future signed OTA mechanism is introduced, it needs an
explicit signature, bridge compatibility, last-known-good rollback, and
native update-required fallback before it is enabled.

## Runtime and dependency decisions

Vercel is pinned to Node 22 to match the repository's type definitions and CI.
The app is a Vite SPA using `BrowserRouter`, `Routes`, `Navigate`, and links;
it does not use React Router loaders, actions, server actions, RSC, SSR
hydration, `ScrollRestoration`, or framework single-fetch endpoints. The
remaining `npm audit --omit=dev` React Router advisory applies to those server
features, not this client-only route surface. Keep the dependency current and
re-run the audit on every dependency update rather than using `audit fix --force`.

## Supabase rollout order

Review and apply the new migrations to a staging project first, then production:

1. `20260804150000_account_cleanup_and_private_retention.sql`
2. `20260804150100_repair_canonical_voice_rpcs.sql`

Verify the six-argument Voice functions, private table grants/RLS, the account
cleanup function, and the absence of the old memory rollback backup. Do not
delete current-month Voice lease rows during cleanup; the migration retains
two full months for authoritative usage calculations.

The Supabase advisor may report RLS disabled on private implementation tables.
This branch enables RLS with no client policies and keeps access through the
service role/`SECURITY DEFINER` functions only. Confirm the service-role RPC
path in staging before production rollout.
