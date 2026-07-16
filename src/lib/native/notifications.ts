import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import { isNativePlatform } from "./platform";

const DAILY_REFLECTION_NOTIFICATION_ID = 1001;
let pushListenerHandles: PluginListenerHandle[] = [];

const removePushNotificationListeners = async () => {
  const handles = pushListenerHandles;
  pushListenerHandles = [];
  await Promise.all(handles.map((handle) => handle.remove().catch(() => undefined)));
};

export async function requestLocalNotificationPermission() {
  if (!isNativePlatform()) return false;

  const current = await LocalNotifications.checkPermissions();
  if (current.display === "granted") return true;

  const requested = await LocalNotifications.requestPermissions();
  return requested.display === "granted";
}

export async function scheduleDailyReflectionReminder(hour = 8, minute = 0, days = [1, 2, 3, 4, 5, 6, 7]) {
  const normalizedDays = [...new Set(days)].filter((day) => Number.isInteger(day) && day >= 1 && day <= 7);
  if (normalizedDays.length === 0) return false;

  if (!(await requestLocalNotificationPermission())) return false;

  await cancelDailyReflectionReminder();

  const notifications = normalizedDays.map((day, index) => ({
    id: DAILY_REFLECTION_NOTIFICATION_ID + index,
    title: "Bible Nova Companion",
    body: "Take a quiet moment for prayer and reflection.",
    schedule: {
      on: { weekday: day, hour, minute },
      repeats: true,
    },
  }));

  await LocalNotifications.schedule({ notifications });

  return true;
}

export async function cancelDailyReflectionReminder() {
  if (!isNativePlatform()) return;
  
  const notifications = Array.from({ length: 7 }, (_, i) => ({
    id: DAILY_REFLECTION_NOTIFICATION_ID + i,
  }));

  await LocalNotifications.cancel({ notifications });
}

export async function registerForPushNotifications(onToken?: (token: string) => void) {
  if (!isNativePlatform()) return false;

  const current = await PushNotifications.checkPermissions();
  const permission =
    current.receive === "granted" ? current : await PushNotifications.requestPermissions();

  if (permission.receive !== "granted") return false;

  await removePushNotificationListeners();
  return new Promise<boolean>((resolve, reject) => {
    let settled = false;
    let timeoutId: number | null = null;

    const finalize = async (result: boolean, error?: unknown) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }

      if (!result) {
        await removePushNotificationListeners();
      }

      if (error) {
        reject(error);
        return;
      }

      resolve(result);
    };

    void (async () => {
      try {
        pushListenerHandles = await Promise.all([
          PushNotifications.addListener("registration", (token) => {
            onToken?.(token.value);
            void finalize(true);
          }),
          PushNotifications.addListener("registrationError", (error) => {
            console.warn("Push registration failed:", error);
            void finalize(
              false,
              new Error(
                typeof error.error === "string"
                  ? error.error
                  : "Push registration failed.",
              ),
            );
          }),
        ]);

        await PushNotifications.register();
        if (settled) {
          return;
        }

        timeoutId = window.setTimeout(() => {
          void finalize(false, new Error("Push registration timed out."));
        }, 10000);
      } catch (error) {
        await finalize(
          false,
          error instanceof Error ? error : new Error("Push registration failed."),
        );
      }
    })();
  });
}

export async function unregisterFromPushNotifications() {
  if (!isNativePlatform()) return;
  await PushNotifications.unregister();
  await removePushNotificationListeners();
}
