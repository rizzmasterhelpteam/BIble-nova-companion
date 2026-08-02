import type { NetworkStatus, PlatformAdapter, ReminderSchedule, ReminderStatus } from "./types";
import { API_CONTRACT_VERSION, NATIVE_BRIDGE_VERSION } from "./types";
import { getNativeRuntimeInfo } from "../lib/native/runtime";

const getNetworkStatus = (): NetworkStatus => ({
  connected: typeof navigator === "undefined" ? true : navigator.onLine,
  connectionType: "web",
});

const scheduleWebReminder = async (_schedule: ReminderSchedule) => false;
const getWebReminderStatus = async (): Promise<ReminderStatus> => ({
  permissionGranted: false,
  schedules: [],
});

export const webPlatform: PlatformAdapter = {
  kind: "web",
  isNative: false,
  nativeBridgeVersion: NATIVE_BRIDGE_VERSION,
  apiContractVersion: API_CONTRACT_VERSION,
  runtime: getNativeRuntimeInfo(),
  getAppVersion: () => import.meta.env.VITE_APP_VERSION?.trim() || "web",
  auth: {
    signInWithGoogle: async () => {
      throw new Error("Use the browser sign-in flow on the web.");
    },
  },
  purchases: {
    supported: false,
    restore: async () => [],
    openManagement: async () => undefined,
  },
  reminders: {
    supported: false,
    getId: (day) => 1_000 + day,
    getStatus: getWebReminderStatus,
    schedule: scheduleWebReminder,
    cancel: async () => undefined,
  },
  haptics: {
    impact: async () => undefined,
    notification: async () => undefined,
  },
  network: {
    getStatus: async () => getNetworkStatus(),
    subscribe: (listener) => {
      if (typeof window === "undefined") return () => undefined;
      const handleOnline = () => listener(getNetworkStatus());
      const handleOffline = () => listener(getNetworkStatus());
      window.addEventListener("online", handleOnline);
      window.addEventListener("offline", handleOffline);
      return () => {
        window.removeEventListener("online", handleOnline);
        window.removeEventListener("offline", handleOffline);
      };
    },
  },
  appState: {
    subscribe: (listener) => {
      if (typeof document === "undefined") return () => undefined;
      const handleVisibility = () => listener({ active: document.visibilityState === "visible" });
      document.addEventListener("visibilitychange", handleVisibility);
      return () => document.removeEventListener("visibilitychange", handleVisibility);
    },
  },
  backButton: {
    subscribe: () => () => undefined,
  },
};
