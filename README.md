<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Bible Nova Companion

Bible Nova Companion is a web-first AI reflection app. The browser is the
canonical client: Vercel serves the SPA and API routes, Supabase provides
authentication and private user data, and server-only Vercel functions call
Groq, Gemini, and Google Cloud Text-to-Speech. Capacitor remains an optional
Android wrapper for Google Play billing and native device integrations.

## Web architecture

Production web requests use same-origin `/api/*` routes. This keeps browser
auth, CORS, cookies, and deployment environments aligned and avoids exposing
provider credentials. The browser handles microphone permission, PCM voice
audio, MediaRecorder transcription fallback, and speech playback; provider
keys and entitlement checks remain server-side. The web build is installable as
a PWA and uses a network-first shell cache without caching API responses.

Google Play billing remains Android-only in this configuration. A web checkout
requires a separate billing provider and webhook/entitlement design; it should
not be simulated with client-side premium flags.

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
- `GROQ_FALLBACK_MODEL` optional secondary Groq chat model
- `GROQ_TRANSCRIBE_MODEL` optional Groq speech model; defaults to `whisper-large-v3-turbo`
- `GEMINI_API_KEY` required server-only key for Gemini 3.1 Flash Live Voice Mode
- Gemini Live Voice Mode uses the fixed `Algenib` voice.
- `VOICE_WEB_PAYMENT_BYPASS=true` and `VOICE_WEB_TEST_ORIGIN=https://…` temporarily allow authenticated browser testing of Voice without a premium entitlement; leave both unset in normal deployments
- `GOOGLE_TTS_SERVICE_ACCOUNT_JSON` required server-only Google Cloud service-account JSON with Text-to-Speech access
- `GOOGLE_TTS_LANGUAGE_CODE` optional language code; defaults to `en-AU`
- `GOOGLE_TTS_VOICE_NAME` optional voice; defaults to `en-AU-Chirp3-HD-Algenib`
- `VOICE_SESSION_MAX_MINUTES` optional voice-session limit from 1–15 minutes; defaults to `15`
- `SUPABASE_SERVICE_ROLE_KEY` required server-only for account deletion, persistent rate limits, and subscription entitlements
- `RATE_LIMIT_IP_SALT` optional server-only random value used to hash IP-based rate-limit keys; the server-only Supabase service-role key is used as a secure fallback
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` required server-only JSON credentials for verified Android subscriptions
- `VITE_API_BASE_URL` required in native mobile builds, set to your Vercel site URL
- Capacitor Android release builds load the verified local `dist` bundle. Set `CAPACITOR_LIVE_RELOAD=true` with a local URL for development only; production builds must not use Capacitor `server.url` to load Vercel directly.
- `APP_ORIGIN`, `CAPACITOR_ANDROID_ORIGIN`, and `CAPACITOR_IOS_ORIGIN` define the exact authenticated API origins; preview origins must be listed explicitly in `VERCEL_PREVIEW_ORIGINS` or `VERCEL_PREVIEW_ORIGIN_PATTERN`.
- `VITE_GOOGLE_PLAY_PUBLIC_KEY` optional Google Play monetization RSA public key for Android billing or verification integrations
- `VITE_IAP_MONTHLY_PRODUCT_ID` and `VITE_IAP_YEARLY_PRODUCT_ID` required for native subscription IAP
- `VITE_IAP_MONTHLY_BASE_PLAN_ID` and `VITE_IAP_YEARLY_BASE_PLAN_ID` required for Android subscription IAP (Google Play base plans)

`VITE_` variables are embedded into the browser bundle. Keep `GEMINI_API_KEY`, `GROQ_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `GOOGLE_TTS_SERVICE_ACCOUNT_JSON` server-only.
Keep `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` server-only as well; the native subscription endpoint fails closed when Google Play verification or server persistence is not configured. Immersive Voice Mode streams PCM audio directly between the client and Gemini 3.1 Flash Live using a short-lived, one-use token minted only after authentication, premium eligibility, rate-limit, and active-session checks. The Gemini API key is never bundled into Android. Text chat, chat microphone dictation, and text-to-speech remain on their existing providers.

## Production Database Migration

Apply `supabase/migrations/20260716123000_production_hardening.sql` and any later migrations to the production Supabase project before enabling the hardened API routes. It creates private persistent rate-limit buckets, the service-role-only `subscription_entitlements` table, and the restricted RPCs used by the server.

The current hardening migrations that must be applied after the existing live
schema are:

- `20260804130000_add_atomic_rate_limits.sql` — replaces the separate
  per-bucket rate-limit calls with one transactional RPC.
- `20260804131500_remove_legacy_voice_rpc_overloads.sql` — removes the
  ambiguous Voice RPC overloads; the server uses only the six-argument
  monthly-limit functions.
- `20260804133000_remove_shadow_memory_rollback_backup.sql` — removes the
  temporary private rollback snapshot after the explicit-consent cleanup.

Apply and verify these in a staging Supabase database first, then apply them
to production. The production server must be deployed with the matching
atomic rate-limit and canonical Voice RPC code before the old RPCs are
removed. Never commit or print service-role, Google Play, Gemini, Groq, or
Google TTS credentials.

In Supabase Auth, keep Anonymous Sign-Ins disabled. The app requires a permanent signed-in account.

## Mobile Builds

This app is configured with Capacitor for Android and iOS.

- Sync native projects: `npm run cap:sync`
- Open Android Studio: `npm run android:open`
- Open Xcode: `npm run ios:open` (requires macOS)

For mobile builds, set `VITE_API_BASE_URL` to the deployed Vercel URL so the bundled Android UI calls `/api/*` on Vercel. The release shell never points Capacitor `server.url` at Vercel: it ships the complete local `dist` bundle and remains usable when Vercel is unavailable. Frontend changes require a new APK until a signed, compatible OTA web-bundle provider is selected and configured. The repository contains compatibility types for a signed manifest, but OTA delivery is intentionally disabled until that provider is configured.
For native Google sign-in on mobile:

- `VITE_GOOGLE_WEB_CLIENT_ID` is an optional Android override; a public Bible Nova client ID is included as the clean-build fallback.
- Set `VITE_GOOGLE_IOS_CLIENT_ID` for iOS.
- `npm run cap:sync` now derives the iOS reversed client ID URL scheme from `VITE_GOOGLE_IOS_CLIENT_ID` and writes it into `ios/App/App/Info.plist`.
- In Supabase Auth -> Google provider, add the client IDs for every platform you support. This app still uses Supabase OAuth on the web, so keep the normal web Google OAuth configuration for browser builds.
- For Android, make sure the installed build's SHA-1 matches the Android OAuth client in Google Cloud or Firebase, or native Google sign-in will fail even though the code path is correct.

### Voice-first home

The authenticated home screen opens in Voice mode for new users and remembers each user's Voice/Chat selection. Gemini Live remains the Voice data plane: the client captures PCM microphone audio and streams it directly to the short-lived Gemini Live session; Vercel only authenticates the request, checks entitlement and rate limits, holds the Supabase lease, and mints the constrained token. Voice audio is not routed through a record-upload-transcribe-TTS replacement. Text chat, chat microphone dictation, and text-to-speech remain on their existing providers.

The Supabase Voice reservation remains the source of truth for premium eligibility, concurrency, and usage duration. The browser and Android client receive only an opaque reservation handle; Groq, Google Cloud, and Supabase administrative credentials remain in server-only Vercel variables.
