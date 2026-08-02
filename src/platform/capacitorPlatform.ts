import { Capacitor } from "@capacitor/core";
import type { NetworkStatus, PlatformAdapter, ReminderSchedule, ReminderStatus } from "./types";
import { API_CONTRACT_VERSION } from "./types";

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

type NativeListenerHandle = {
  remove: () => Promise<void>;
};

const subscribeToNativeListener = (
  load: () => Promise<NativeListenerHandle>,
) => {
  let disposed = false;
  let handle: NativeListenerHandle | null = null;

  void load()
    .then((nextHandle) => {
      if (disposed) {
        void nextHandle.remove().catch(() => undefined);
        return;
      }
      handle = nextHandle;
    })
    .catch(() => undefined);

  return () => {
    disposed = true;
    const currentHandle = handle;
    handle = null;
    if (currentHandle) void currentHandle.remove().catch(() => undefined);
  };
};

export const capacitorPlatform: PlatformAdapter = {
  kind: Capacitor.getPlatform() === "android"
    ? "android"
    : Capacitor.getPlatform() === "ios"
      ? "ios"
    : "unknown",
  isNative: Capacitor.isNativePlatform(),
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
    subscribe: (listener) => subscribeToNativeListener(async () => {
      const { Network } = await import("@capacitor/network");
      return Network.addListener("networkStatusChange", (status) => {
          listener({ connected: status.connected, connectionType: status.connectionType });
        });
    }),
  },
  appState: {
    subscribe: (listener) => subscribeToNativeListener(async () => {
      const { App } = await import("@capacitor/app");
      return App.addListener("appStateChange", ({ isActive }) => listener({ active: isActive }));
    }),
  },
  backButton: {
    subscribe: (listener) => subscribeToNativeListener(async () => {
      const { App } = await import("@capacitor/app");
      return App.addListener("backButton", listener);
    }),
  },
};
