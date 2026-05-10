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
- `VITE_REVENUECAT_IOS_API_KEY` and `VITE_REVENUECAT_ANDROID_API_KEY` required for native IAP

`VITE_` variables are embedded into the browser bundle. Keep `GROQ_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `GEMINI_API_KEY` server-only.

## Mobile Builds

This app is configured with Capacitor for Android and iOS.

- Sync native projects: `npm run cap:sync`
- Open Android Studio: `npm run android:open`
- Open Xcode: `npm run ios:open` (requires macOS)

For mobile builds, set `VITE_API_BASE_URL` to the deployed Vercel URL so native requests call `/api/*` on Vercel instead of the local WebView origin.
