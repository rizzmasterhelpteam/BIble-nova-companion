import { beforeEach, describe, expect, it, vi } from "vitest";

const localNotifications = vi.hoisted(() => ({
  checkPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  schedule: vi.fn(),
  cancel: vi.fn(),
  getPending: vi.fn(),
}));

vi.mock("@capacitor/local-notifications", () => ({
  LocalNotifications: localNotifications,
}));
vi.mock("../src/lib/native/platform", () => ({
  isNativePlatform: () => true,
  getNativePlatform: () => "android",
}));

import {
  cancelDailyReflectionReminder,
  getDailyReflectionReminderStatus,
  scheduleDailyReflectionReminder,
} from "../src/lib/native/notifications";
import {
  DEFAULT_REMINDER_DAYS,
  DEFAULT_REMINDER_TIME,
  normalizeReminderDays,
  normalizeReminderTime,
  parseStoredReminderDays,
} from "../src/lib/dailyReminderPreferences";

describe("daily reminder preferences", () => {
  it("recovers invalid, empty, and malformed stored values", () => {
    expect(normalizeReminderTime("25:72")).toBe(DEFAULT_REMINDER_TIME);
    expect(normalizeReminderTime("07:30")).toBe("07:30");
    expect(parseStoredReminderDays("[]")).toEqual(DEFAULT_REMINDER_DAYS);
    expect(parseStoredReminderDays("not-json")).toEqual(DEFAULT_REMINDER_DAYS);
    expect(normalizeReminderDays([7, 2, 2, 0, 8, "3"])).toEqual([2, 7]);
  });
});

describe("native daily reminder scheduling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localNotifications.checkPermissions.mockResolvedValue({ display: "granted" });
    localNotifications.requestPermissions.mockResolvedValue({ display: "granted" });
    localNotifications.schedule.mockResolvedValue({ notifications: [] });
    localNotifications.cancel.mockResolvedValue(undefined);
  });

  it("uses stable weekday IDs and removes only inactive reminder IDs", async () => {
    localNotifications.getPending.mockResolvedValue({
      notifications: [
        { id: 1002, schedule: { on: { weekday: 2, hour: 7, minute: 30 } } },
        { id: 1006, schedule: { on: { weekday: 6, hour: 7, minute: 30 } } },
      ],
    });

    await expect(scheduleDailyReflectionReminder(7, 30, [6, 2])).resolves.toBe(true);
    expect(localNotifications.schedule).toHaveBeenCalledWith({
      notifications: [
        expect.objectContaining({
          id: 1002,
          schedule: {
            on: { weekday: 2, hour: 7, minute: 30 },
            repeats: true,
          },
        }),
        expect.objectContaining({
          id: 1006,
          schedule: {
            on: { weekday: 6, hour: 7, minute: 30 },
            repeats: true,
          },
        }),
      ],
    });
    expect(localNotifications.cancel).toHaveBeenCalledWith({
      notifications: [
        { id: 1001 },
        { id: 1003 },
        { id: 1004 },
        { id: 1005 },
        { id: 1007 },
      ],
    });
  });

  it("does not modify schedules when notification permission is denied", async () => {
    localNotifications.checkPermissions.mockResolvedValue({ display: "denied" });
    localNotifications.requestPermissions.mockResolvedValue({ display: "denied" });

    await expect(scheduleDailyReflectionReminder(8, 0, [1])).resolves.toBe(false);
    expect(localNotifications.schedule).not.toHaveBeenCalled();
    expect(localNotifications.cancel).not.toHaveBeenCalled();
  });

  it("schedules reminders without Android exact-alarm access", async () => {
    localNotifications.getPending.mockResolvedValue({
      notifications: [{ id: 1001, schedule: { on: { weekday: 1, hour: 8, minute: 0 } } }],
    });
    await expect(scheduleDailyReflectionReminder(8, 0, [1])).resolves.toBe(true);
    expect(localNotifications.schedule).toHaveBeenCalledTimes(1);
  });

  it("reads the actual pending weekday, time, and permission state", async () => {
    localNotifications.getPending.mockResolvedValue({
      notifications: [
        { id: 1001, schedule: { on: { weekday: 4, hour: 19, minute: 15 } } },
        { id: 5000, schedule: { on: { weekday: 1, hour: 8, minute: 0 } } },
      ],
    });

    await expect(getDailyReflectionReminderStatus()).resolves.toEqual({
      permissionGranted: true,
      schedules: [{ id: 1001, day: 4, hour: 19, minute: 15 }],
    });
  });

  it("cancels all seven owned reminder IDs", async () => {
    await cancelDailyReflectionReminder();

    expect(localNotifications.cancel).toHaveBeenCalledWith({
      notifications: Array.from({ length: 7 }, (_, index) => ({ id: 1001 + index })),
    });
  });
});
