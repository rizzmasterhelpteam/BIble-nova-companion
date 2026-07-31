import { LocalNotifications } from "@capacitor/local-notifications";
import { PushNotifications } from "@capacitor/push-notifications";
import type { PluginListenerHandle } from "@capacitor/core";
import { isNativePlatform } from "./platform";

const DAILY_REFLECTION_NOTIFICATION_ID = 1001;
const DAILY_REFLECTION_NOTIFICATION_IDS = Array.from(
  { length: 7 },
  (_, index) => DAILY_REFLECTION_NOTIFICATION_ID + index,
);
let pushListenerHandles: PluginListenerHandle[] = [];

export const getDailyReflectionReminderId = (day: number) =>
  DAILY_REFLECTION_NOTIFICATION_ID + day - 1;

export type DailyReflectionReminderSchedule = {
  id: number;
  day: number;
  hour: number | null;
  minute: number | null;
};

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
  const normalizedDays = [...new Set(days)]
    .filter((day) => Number.isInteger(day) && day >= 1 && day <= 7)
    .sort((left, right) => left - right);
  if (normalizedDays.length === 0) return false;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error("Choose a valid reminder time.");
  }

  if (!(await requestLocalNotificationPermission())) return false;

  const notifications = normalizedDays.map((day) => ({
    id: getDailyReflectionReminderId(day),
    title: "Bible Nova Companion",
    body: "Take a quiet moment for prayer and reflection.",
    schedule: {
      on: { weekday: day, hour, minute },
      repeats: true,
      // Android otherwise defers scheduled work aggressively while a phone is
      // idle. The plugin falls back safely when exact alarms are unavailable.
      allowWhileIdle: true,
    },
  }));

  await LocalNotifications.schedule({ notifications });

  const desiredIds = new Set(notifications.map(({ id }) => id));
  const inactiveNotifications = DAILY_REFLECTION_NOTIFICATION_IDS
    .filter((id) => !desiredIds.has(id))
    .map((id) => ({ id }));
  if (inactiveNotifications.length) {
    await LocalNotifications.cancel({ notifications: inactiveNotifications });
  }

  const pending = await LocalNotifications.getPending();
  return notifications.every(({ id }) =>
    pending.notifications.some((notification) => notification.id === id),
  );
}

export async function cancelDailyReflectionReminder() {
  if (!isNativePlatform()) return;

  await LocalNotifications.cancel({
    notifications: DAILY_REFLECTION_NOTIFICATION_IDS.map((id) => ({ id })),
  });
}

export async function getDailyReflectionReminderStatus() {
  if (!isNativePlatform()) {
    return {
      permissionGranted: false,
      schedules: [] as DailyReflectionReminderSchedule[],
    };
  }

  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== "granted") {
    return {
      permissionGranted: false,
      schedules: [] as DailyReflectionReminderSchedule[],
    };
  }

  const pending = await LocalNotifications.getPending();
  const schedules = pending.notifications
    .filter(({ id }) => DAILY_REFLECTION_NOTIFICATION_IDS.includes(id))
    .map((notification) => {
      const configuredDay = notification.schedule?.on?.weekday;
      const fallbackDay = notification.id - DAILY_REFLECTION_NOTIFICATION_ID + 1;
      const day =
        typeof configuredDay === "number" && configuredDay >= 1 && configuredDay <= 7
          ? configuredDay
          : fallbackDay;
      const hour = notification.schedule?.on?.hour;
      const minute = notification.schedule?.on?.minute;

      return {
        id: notification.id,
        day,
        hour: typeof hour === "number" ? hour : null,
        minute: typeof minute === "number" ? minute : null,
      };
    })
    .filter(({ day }) => day >= 1 && day <= 7)
    .sort((left, right) => left.day - right.day);

  return { permissionGranted: true, schedules };
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
