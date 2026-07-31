export const DEFAULT_REMINDER_TIME = "08:00";
export const DEFAULT_REMINDER_DAYS = [1, 2, 3, 4, 5, 6, 7];

const REMINDER_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export const normalizeReminderDays = (value: unknown): number[] => {
  if (!Array.isArray(value)) return [];

  return [...new Set(value)]
    .filter(
      (day): day is number =>
        typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 7,
    )
    .sort((left, right) => left - right);
};

export const parseStoredReminderDays = (value: string | null): number[] => {
  if (!value) return [...DEFAULT_REMINDER_DAYS];

  try {
    const normalized = normalizeReminderDays(JSON.parse(value));
    return normalized.length ? normalized : [...DEFAULT_REMINDER_DAYS];
  } catch {
    return [...DEFAULT_REMINDER_DAYS];
  }
};

export const normalizeReminderTime = (value: string | null): string =>
  value && REMINDER_TIME_PATTERN.test(value) ? value : DEFAULT_REMINDER_TIME;

export const parseReminderTime = (value: string) => {
  const normalized = normalizeReminderTime(value);
  const [hour, minute] = normalized.split(":").map(Number);
  return { hour, minute };
};
