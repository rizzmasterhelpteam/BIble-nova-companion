import { hasNativeGoogleAuthConfig, initializeNativeGoogleAuth } from "./auth";
import { isNativePlatform } from "./platform";

let nativeSplashHidden = false;
let nativeAppInitializationPromise: Promise<void> | null = null;
let nativeModulesPromise: Promise<{
  App: typeof import("@capacitor/app").App;
  Keyboard: typeof import("@capacitor/keyboard").Keyboard;
  Network: typeof import("@capacitor/network").Network;
  SplashScreen: typeof import("@capacitor/splash-screen").SplashScreen;
  StatusBar: typeof import("@capacitor/status-bar").StatusBar;
  Style: typeof import("@capacitor/status-bar").Style;
}> | null = null;

const loadNativeModules = async () => {
  if (!nativeModulesPromise) {
    nativeModulesPromise = Promise.all([
      import("@capacitor/app"),
      import("@capacitor/keyboard"),
      import("@capacitor/network"),
      import("@capacitor/splash-screen"),
      import("@capacitor/status-bar"),
    ]).then(([appModule, keyboardModule, networkModule, splashScreenModule, statusBarModule]) => ({
      App: appModule.App,
      Keyboard: keyboardModule.Keyboard,
      Network: networkModule.Network,
      SplashScreen: splashScreenModule.SplashScreen,
      StatusBar: statusBarModule.StatusBar,
      Style: statusBarModule.Style,
    }));
  }

  return nativeModulesPromise;
};

export async function hideNativeSplashScreen() {
  if (!isNativePlatform() || nativeSplashHidden) return;

  nativeSplashHidden = true;
  try {
    const { SplashScreen } = await loadNativeModules();
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
    const { App, Keyboard, Network, StatusBar, Style } = await loadNativeModules();

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
