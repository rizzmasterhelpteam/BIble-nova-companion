import type { CapacitorConfig } from "@capacitor/cli";
import { KeyboardResize } from "@capacitor/keyboard";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const remoteAppUrl = process.env.CAPACITOR_SERVER_URL?.trim() || "https://biblecompanion.vercel.app";

const config: CapacitorConfig = {
  appId: "com.biblenovacompanion.app",
  appName: "Bible Nova Companion",
  webDir: "dist",
  server: {
    url: remoteAppUrl,
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#111827",
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
