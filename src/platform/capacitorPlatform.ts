import { Capacitor } from "@capacitor/core";
import type { NetworkStatus, PlatformAdapter, ReminderSchedule, ReminderStatus } from "./types";
import { API_CONTRACT_VERSION, NATIVE_BRIDGE_VERSION } from "./types";

const getNetworkStatus = async (): Promise<NetworkStatus> => {
  const { Network } = await import("@capacitor/network");
  const status = await Network.getStatus();
  return { connected: status.connected, connectionType: status.connectionType };
};

const scheduleReminder = async ({ hour, minute, days }: ReminderSchedule) => {
  const { scheduleDailyReflectionReminder } = await import("../lib/native/notifications");
  return scheduleDailyReflectionReminder(hour, minute, days);
};

const cancelReminder = async () => {
  const { cancelDailyReflectionReminder } = await import("../lib/native/notifications");
  await cancelDailyReflectionReminder();
};

const getReminderStatus = async (): Promise<ReminderStatus> => {
  const { getDailyReflectionReminderStatus } = await import("../lib/native/notifications");
  return getDailyReflectionReminderStatus();
};

export const capacitorPlatform: PlatformAdapter = {
  kind: Capacitor.getPlatform() === "android"
    ? "android"
    : Capacitor.getPlatform() === "ios"
      ? "ios"
    : "unknown",
  isNative: Capacitor.isNativePlatform(),
  nativeBridgeVersion: NATIVE_BRIDGE_VERSION,
  apiContractVersion: API_CONTRACT_VERSION,
  getAppVersion: () => import.meta.env.VITE_APP_VERSION?.trim() || "native",
  auth: {
    signInWithGoogle: async () => {
      const { signInWithGoogleNative } = await import("../lib/native/auth");
      await signInWithGoogleNative();
    },
  },
  purchases: {
    supported: Capacitor.getPlatform() === "android" || Capacitor.getPlatform() === "ios",
    restore: async () => {
      const { restorePurchases } = await import("../lib/native/purchases");
      return restorePurchases();
    },
    openManagement: async () => {
      const { openSubscriptionManagement } = await import("../lib/native/purchases");
      await openSubscriptionManagement();
    },
  },
  reminders: {
    supported: true,
    getId: (day) => 1_001 + day - 1,
    getStatus: getReminderStatus,
    schedule: scheduleReminder,
    cancel: cancelReminder,
  },
  haptics: {
    impact: async (style = "LIGHT") => {
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
      await Haptics.impact({ style: ImpactStyle[style] });
    },
    notification: async (type = "SUCCESS") => {
      const { Haptics, NotificationType } = await import("@capacitor/haptics");
      await Haptics.notification({ type: NotificationType[type] });
    },
  },
  network: {
    getStatus: getNetworkStatus,
    subscribe: (listener) => {
      let removeListener = () => undefined;
      void import("@capacitor/network").then(({ Network }) =>
        Network.addListener("networkStatusChange", (status) => {
          listener({ connected: status.connected, connectionType: status.connectionType });
        }).then((handle) => {
          removeListener = () => void handle.remove();
        }),
      );
      return () => removeListener();
    },
  },
  appState: {
    subscribe: (listener) => {
      let removeListener = () => undefined;
      void import("@capacitor/app").then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => listener({ active: isActive }))
          .then((handle) => {
            removeListener = () => void handle.remove();
          }),
      );
      return () => removeListener();
    },
  },
  backButton: {
    subscribe: (listener) => {
      let removeListener = () => undefined;
      void import("@capacitor/app").then(({ App }) =>
        App.addListener("backButton", listener).then((handle) => {
          removeListener = () => void handle.remove();
        }),
      );
      return () => removeListener();
    },
  },
};
