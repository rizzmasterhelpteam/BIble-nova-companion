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

const NATIVE_OPERATION_TIMEOUT_MS = 2500;

const withNativeTimeout = <T,>(
  operation: Promise<T>,
  label: string,
  timeoutMs = NATIVE_OPERATION_TIMEOUT_MS,
) =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`${label} timed out.`));
    }, timeoutMs);

    operation.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });

const loadNativeModules = async () => {
  if (!nativeModulesPromise) {
    nativeModulesPromise = withNativeTimeout(
      Promise.all([
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
      })),
      "Native module loading",
    ).catch((error) => {
      nativeModulesPromise = null;
      throw error;
    });
  }

  return nativeModulesPromise;
};

export async function hideNativeSplashScreen() {
  if (!isNativePlatform() || nativeSplashHidden) return;

  nativeSplashHidden = true;
  try {
    const { SplashScreen } = await loadNativeModules();
    await withNativeTimeout(SplashScreen.hide(), "Native splash hide");
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
    const { hasNativeGoogleAuthConfig, initializeNativeGoogleAuth } = await import("./auth");
    const { App, Keyboard, Network, StatusBar, Style } = await loadNativeModules();

    try {
      await withNativeTimeout(StatusBar.setStyle({ style: Style.Dark }), "Status bar style");
      await withNativeTimeout(StatusBar.setBackgroundColor({ color: "#111827" }), "Status bar color");
    } catch {
      // Some platforms do not support all status bar controls.
    }

    try {
      await withNativeTimeout(Keyboard.setAccessoryBarVisible({ isVisible: false }), "Keyboard setup");
    } catch {
      // Keyboard accessory controls are iOS-only.
    }

    if (hasNativeGoogleAuthConfig()) {
      void withNativeTimeout(initializeNativeGoogleAuth(), "Native Google initialization").catch((error) => {
        console.warn("Native Google sign-in was not initialized:", error);
      });
    }

    void withNativeTimeout(
      App.addListener("appStateChange", ({ isActive }) => {
        if (isActive) {
          void Network.getStatus().catch(() => undefined);
        }
      }),
      "Native app listener",
    ).catch((error) => {
      console.warn("Native app listener was not registered:", error);
    });
  })().catch((error) => {
    nativeAppInitializationPromise = null;
    throw error;
  });

  return nativeAppInitializationPromise;
}
