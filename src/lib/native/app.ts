import { App } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { Network } from "@capacitor/network";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { isNativePlatform } from "./platform";
import { initializePurchases } from "./purchases";

let nativeSplashHidden = false;

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

  void App.addListener("appStateChange", ({ isActive }) => {
    if (isActive) {
      void Network.getStatus();
    }
  });
}
