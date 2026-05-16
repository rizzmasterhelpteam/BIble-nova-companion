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

export async function scheduleDailyReflectionReminder(hour = 8, minute = 0) {
  if (!(await requestLocalNotificationPermission())) return false;

  await LocalNotifications.schedule({
    notifications: [
      {
        id: DAILY_REFLECTION_NOTIFICATION_ID,
        title: "Bible Nova Companion",
        body: "Take a quiet moment for prayer and reflection.",
        schedule: {
          on: { hour, minute },
          repeats: true,
        },
      },
    ],
  });

  return true;
}

export async function cancelDailyReflectionReminder() {
  if (!isNativePlatform()) return;
  await LocalNotifications.cancel({
    notifications: [{ id: DAILY_REFLECTION_NOTIFICATION_ID }],
  });
}

export async function registerForPushNotifications(onToken?: (token: string) => void) {
  if (!isNativePlatform()) return false;

  const current = await PushNotifications.checkPermissions();
  const permission =
    current.receive === "granted" ? current : await PushNotifications.requestPermissions();

  if (permission.receive !== "granted") return false;

  await removePushNotificationListeners();
  pushListenerHandles = await Promise.all([
    PushNotifications.addListener("registration", (token) => {
      onToken?.(token.value);
    }),
    PushNotifications.addListener("registrationError", (error) => {
      console.warn("Push registration failed:", error);
    }),
  ]);

  await PushNotifications.register();
  return true;
}

export async function unregisterFromPushNotifications() {
  if (!isNativePlatform()) return;
  await PushNotifications.unregister();
  await removePushNotificationListeners();
}
