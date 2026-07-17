<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/e789b0f9-d90a-4843-85de-8a5d53332a75

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Copy [.env.example](.env.example) to `.env.local` and fill in the keys you need
3. Run the app:
   `npm run dev`

## Vercel Environment Variables

Set these in Vercel for the environments you deploy to:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `GROQ_API_KEY`
- `GROQ_MODEL` required for production; use a currently supported provider model and do not rely on a deprecated fallback
- `SUPABASE_SERVICE_ROLE_KEY` required server-only for account deletion, persistent rate limits, and subscription entitlements
- `RATE_LIMIT_IP_SALT` required server-only random value used to hash IP-based rate-limit keys
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` required server-only JSON credentials for verified Android subscriptions
- `GEMINI_API_KEY` only needed for `/api/generate`
- `VITE_API_BASE_URL` required in native mobile builds, set to your Vercel site URL
- Release Capacitor builds load bundled `dist` assets. Set `CAPACITOR_LIVE_RELOAD=true` and `CAPACITOR_SERVER_URL` only for local live reload; never enable it for a release build.
- `VITE_GOOGLE_PLAY_PUBLIC_KEY` optional Google Play monetization RSA public key for Android billing or verification integrations
- `VITE_IAP_MONTHLY_PRODUCT_ID` and `VITE_IAP_YEARLY_PRODUCT_ID` required for native subscription IAP
- `VITE_IAP_MONTHLY_BASE_PLAN_ID` and `VITE_IAP_YEARLY_BASE_PLAN_ID` required for Android subscription IAP (Google Play base plans)

`VITE_` variables are embedded into the browser bundle. Keep `GROQ_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY` server-only.
Keep `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` server-only as well; the native subscription endpoint fails closed when Google Play verification is not configured. Rate-limit persistence also fails closed when the server-only Supabase role or `RATE_LIMIT_IP_SALT` is missing.

## Production Database Migration

Apply `supabase/migrations/20260716123000_production_hardening.sql` and any later migrations to the production Supabase project before enabling the hardened API routes. It creates private persistent rate-limit buckets, the service-role-only `subscription_entitlements` table, and the restricted RPCs used by the server.

In Supabase Auth, keep Anonymous Sign-Ins disabled. The app requires a permanent signed-in account.

## Mobile Builds

This app is configured with Capacitor for Android and iOS.

- Sync native projects: `npm run cap:sync`
- Open Android Studio: `npm run android:open`
- Open Xcode: `npm run ios:open` (requires macOS)

For mobile builds, set `VITE_API_BASE_URL` to the deployed Vercel URL so native requests call `/api/*` on Vercel instead of the local WebView origin.
The native wrapper uses bundled web assets in release builds, so UI changes require rebuilding the APK/IPA. API requests still use the deployed Vercel URL via `VITE_API_BASE_URL`, and the app shows a recoverable error page if bundled assets fail to load.
For native Google sign-in on mobile:

- `VITE_GOOGLE_WEB_CLIENT_ID` is an optional Android override; a public Bible Nova client ID is included as the clean-build fallback.
- Set `VITE_GOOGLE_IOS_CLIENT_ID` for iOS.
- `npm run cap:sync` now derives the iOS reversed client ID URL scheme from `VITE_GOOGLE_IOS_CLIENT_ID` and writes it into `ios/App/App/Info.plist`.
- In Supabase Auth -> Google provider, add the client IDs for every platform you support. This app still uses Supabase OAuth on the web, so keep the normal web Google OAuth configuration for browser builds.
- For Android, make sure the installed build's SHA-1 matches the Android OAuth client in Google Cloud or Firebase, or native Google sign-in will fail even though the code path is correct.
