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
- `GROQ_MODEL` optional, defaults to `meta-llama/llama-4-scout-17b-16e-instruct`
- `SUPABASE_SERVICE_ROLE_KEY` only needed for signed-in account deletion
- `GEMINI_API_KEY` only needed for `/api/generate`
- `VITE_API_BASE_URL` required in native mobile builds, set to your Vercel site URL
- `CAPACITOR_SERVER_URL` controls the web app loaded by the native wrapper; it defaults to `https://biblecompanion.vercel.app`
- `VITE_GOOGLE_PLAY_PUBLIC_KEY` optional Google Play monetization RSA public key for Android billing or verification integrations
- `VITE_IAP_MONTHLY_PRODUCT_ID` and `VITE_IAP_YEARLY_PRODUCT_ID` required for native subscription IAP
- `VITE_IAP_MONTHLY_BASE_PLAN_ID` and `VITE_IAP_YEARLY_BASE_PLAN_ID` required for Android subscription IAP (Google Play base plans)

`VITE_` variables are embedded into the browser bundle. Keep `GROQ_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY` server-only.

## Mobile Builds

This app is configured with Capacitor for Android and iOS.

- Sync native projects: `npm run cap:sync`
- Open Android Studio: `npm run android:open`
- Open Xcode: `npm run ios:open` (requires macOS)

For mobile builds, set `VITE_API_BASE_URL` to the deployed Vercel URL so native requests call `/api/*` on Vercel instead of the local WebView origin.
The native wrapper loads `CAPACITOR_SERVER_URL` directly, so web UI deployments at that URL appear in installed apps without rebuilding the native shell. This requires an internet connection and the URL must remain stable.
For native Google sign-in on mobile:

- Set `VITE_GOOGLE_WEB_CLIENT_ID` for Android.
- Set `VITE_GOOGLE_IOS_CLIENT_ID` for iOS.
- `npm run cap:sync` now derives the iOS reversed client ID URL scheme from `VITE_GOOGLE_IOS_CLIENT_ID` and writes it into `ios/App/App/Info.plist`.
- In Supabase Auth -> Google provider, add the client IDs for every platform you support. This app still uses Supabase OAuth on the web, so keep the normal web Google OAuth configuration for browser builds.
- For Android, make sure the installed build's SHA-1 matches the Android OAuth client in Google Cloud or Firebase, or native Google sign-in will fail even though the code path is correct.
