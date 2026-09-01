export const AUTOMATIC_REMINDER_DAYS = [1, 2, 3, 4, 5, 6, 7];

/**
 * Stagger the automatic reflection reminder across the evening so devices do
 * not all notify at the same minute. The seed is local/account-scoped and is
 * only used to choose a stable time on that device.
 */
export const getAutomaticReminderTime = (seed: string) => {
  let hash = 0;
  for (const character of seed) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }

  return {
    hour: 18 + (hash % 4),
    minute: [0, 15, 30, 45][(hash >>> 3) % 4],
  };
};

export const normalizeReminderDays = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];

  return [...new Set(value)]
    .filter(
      (day): day is number =>
        typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 7,
    )
    .sort((left, right) => left - right);
};

export const getDailyReminderPreferenceKey = (userId: string) =>
  `bible-nova-daily-reminders-${userId}`;

