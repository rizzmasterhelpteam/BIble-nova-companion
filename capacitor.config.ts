import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const liveReloadEnabled = process.env.CAPACITOR_LIVE_RELOAD === "true";
const liveReloadUrl = process.env.CAPACITOR_SERVER_URL?.trim();

if (liveReloadEnabled && !liveReloadUrl) {
  console.warn("CAPACITOR_LIVE_RELOAD is enabled but CAPACITOR_SERVER_URL is missing. Using bundled assets.");
}

const serverConfig = {
  errorPath: "native-error.html",
  ...(liveReloadEnabled && liveReloadUrl
    ? {
        url: liveReloadUrl,
        androidScheme: "https",
      }
    : {}),
};

const config: CapacitorConfig = {
  appId: "com.biblenovacompanion.app",
  appName: "Bible Nova Companion",
  webDir: "dist",
  // Release builds load the verified bundle copied into webDir. External URLs
  // are opt-in for local live reload only.
  server: serverConfig,
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: "#120E0A",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"],
    },
    Keyboard: {
      resize: KeyboardResize.Native,
      resizeOnFullScreen: true,
    },
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: true,
        twitter: false,
      },
    },
  },
};

export default config;
