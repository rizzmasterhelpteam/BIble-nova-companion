import { isNativePlatform } from "./native/platform";

export const isWebApp = () => !isNativePlatform();

export const registerWebApp = () => {
  if (import.meta.env.DEV || !isWebApp() || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      // PWA support is an enhancement; it must never block app startup.
      if (import.meta.env.DEV) console.warn("Web app shell registration failed:", error);
    });
  }, { once: true });
};
