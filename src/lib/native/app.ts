import { App } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { Network } from "@capacitor/network";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { hasNativeGoogleAuthConfig, initializeNativeGoogleAuth } from "./auth";
import { isNativePlatform } from "./platform";
import { initializePurchases } from "./purchases";

let nativeSplashHidden = false;
let nativeAppInitializationPromise: Promise<void> | null = null;

export async function hideNativeSplashScreen() {
  if (!isNativePlatform() || nativeSplashHidden) return;

  nativeSplashHidden = true;
  try {
    await SplashScreen.hide();
  } catch {
    nativeSplashHidden = false;
  }
}

export async function initializeNativeApp() {
  if (!isNativePlatform()) return;

  if (nativeAppInitializationPromise) {
    return nativeAppInitializationPromise;
  }

  nativeAppInitializationPromise = (async () => {
    try {
      await StatusBar.setStyle({ style: Style.Dark });
      await StatusBar.setBackgroundColor({ color: "#111827" });
    } catch {
      // Some platforms do not support all status bar controls.
    }

    try {
      await Keyboard.setAccessoryBarVisible({ isVisible: false });
    } catch {
      // Keyboard accessory controls are iOS-only.
    }

    await initializePurchases();
    if (hasNativeGoogleAuthConfig()) {
      void initializeNativeGoogleAuth().catch((error) => {
        console.warn("Native Google sign-in was not initialized:", error);
      });
    }

    void App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) {
        void Network.getStatus();
      }
    });
  })();

  return nativeAppInitializationPromise;
}
