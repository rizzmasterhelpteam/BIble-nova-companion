import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const PRODUCTION_URL = "https://biblecompanion.vercel.app";
const productionUrl = process.env.CAPACITOR_PRODUCTION_URL?.trim() || PRODUCTION_URL;
const useDevServer = process.env.CAPACITOR_USE_DEV_SERVER === "true";
const devServerUrl = process.env.CAPACITOR_DEV_SERVER_URL?.trim() || "";

const assertHttpsProductionUrl = (value: string) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "biblecompanion.vercel.app") {
    throw new Error(
      `CAPACITOR_PRODUCTION_URL must be https://biblecompanion.vercel.app, received ${value}`,
    );
  }
  return url.toString().replace(/\/$/, "");
};

const assertDevServerUrl = (value: string) => {
  if (!value) {
    throw new Error("CAPACITOR_DEV_SERVER_URL is required when CAPACITOR_USE_DEV_SERVER=true.");
  }
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("CAPACITOR_DEV_SERVER_URL must use http or https.");
  }
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
    throw new Error("CAPACITOR_DEV_SERVER_URL must use a reachable LAN address on Android.");
  }
  return url.toString().replace(/\/$/, "");
};

const remoteUrl = useDevServer ? assertDevServerUrl(devServerUrl) : assertHttpsProductionUrl(productionUrl);
const serverConfig: NonNullable<CapacitorConfig["server"]> = {
  url: remoteUrl,
  androidScheme: "https",
  cleartext: false,
  errorPath: "native-error.html",
  allowNavigation: [new URL(PRODUCTION_URL).hostname],
};

if (useDevServer && new URL(remoteUrl).protocol === "http:") {
  serverConfig.cleartext = true;
  serverConfig.androidScheme = "http";
  serverConfig.allowNavigation?.push(new URL(remoteUrl).hostname);
}

const config: CapacitorConfig = {
  appId: "com.biblenovacompanion.app",
  appName: "Bible Nova Companion",
  // Only the emergency shell is packaged. Production Android loads the
  // current React UI from Vercel through server.url above.
  webDir: "native-shell",
  android: {
    // Keep JS diagnostics available in Android Studio while preventing native
    // bridge calls (including auth payloads) from being echoed to Logcat.
    loggingBehavior: "none",
  },
  server: serverConfig,
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      launchFadeOutDuration: 200,
      backgroundColor: "#050B14",
      androidSplashResourceName: "splash_black",
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
