import React, { Suspense, useEffect, useState } from "react";
import { Outlet, NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Home,
  Wind,
  Heart,
  Flame,
  Sun,
  Moon,
  Monitor,
  Settings2,
  Camera,
  LogOut,
  Brain,
  Pencil,
  Check,
  Trash2,
  AlertTriangle,
  Loader2,
  X,
  ChevronRight,
  Vibrate,
  VibrateOff,
  BellRing,
  BellOff,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useTheme } from "../context/ThemeContext";
import { useAuth } from "../context/AuthContext";
import { useHaptics } from "../context/HapticsContext";
import { useMobileViewport } from "../context/MobileViewportContext";
import { useVoiceSession } from "../context/VoiceSessionContext";
import { getNativePlatform, getPlatformAdapter } from "../lib/native/platform";
import { nativeStorage } from "../lib/native/storage";
import { cn } from "../lib/utils";
import { shouldHideBottomNavigation } from "../lib/mobileLayout";
import RouteContentFallback from "./RouteContentFallback";
import ProfileCapacityCard from "./ProfileCapacityCard";
import {
  DEFAULT_REMINDER_DAYS,
  DEFAULT_REMINDER_TIME,
  normalizeReminderDays,
  normalizeReminderTime,
  parseReminderTime,
  parseStoredReminderDays,
} from "../lib/dailyReminderPreferences";

const DAILY_REMINDER_STORAGE_KEY = "bible-nova-companion-daily-reminders";
const REMINDER_TIME_STORAGE_KEY = "bible-nova-companion-reminder-time";
const REMINDER_DAYS_STORAGE_KEY = "bible-nova-companion-reminder-days";
const REMINDER_DAY_OPTIONS = [
  { id: 1, label: "S", name: "Sunday" },
  { id: 2, label: "M", name: "Monday" },
  { id: 3, label: "T", name: "Tuesday" },
  { id: 4, label: "W", name: "Wednesday" },
  { id: 5, label: "T", name: "Thursday" },
  { id: 6, label: "F", name: "Friday" },
  { id: 7, label: "S", name: "Saturday" },
];

const makeAvatarDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("Choose an image file."));
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      reject(new Error("Choose an image under 8MB."));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.onload = () => {
      const image = new Image();
      image.onerror = () => reject(new Error("Could not load that image."));
      image.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d");

        if (!context) {
          reject(new Error("Could not process that image."));
          return;
        }

        canvas.width = size;
        canvas.height = size;
        const sourceSize = Math.min(image.width, image.height);
        const sourceX = (image.width - sourceSize) / 2;
        const sourceY = (image.height - sourceSize) / 2;

        context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const { hapticsEnabled, setHapticsEnabled } = useHaptics();
  const { bottomInset, isCompactPhone, isKeyboardOpen, isShortPhone, resetKeyboardState } = useMobileViewport();
  const { isVoiceSessionActive, setVoiceSessionActive } = useVoiceSession();
  const {
    user,
    profileName,
    profileAvatarUrl,
    logout,
    deleteAccount,
    updateProfileName,
    updateProfileAvatarUrl,
    memoryEnabled,
    memoryPreferenceLoading,
    updateMemoryPreference,
  } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileEditorOpen, setProfileEditorOpen] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState("");
  const [profileAvatarDraft, setProfileAvatarDraft] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isProcessingAvatar, setIsProcessingAvatar] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);
  const [dailyRemindersEnabled, setDailyRemindersEnabled] = useState(false);
  const [reminderTime, setReminderTime] = useState(DEFAULT_REMINDER_TIME);
  const [reminderDays, setReminderDays] = useState<number[]>([...DEFAULT_REMINDER_DAYS]);
  const [reminderPreferencesReady, setReminderPreferencesReady] = useState(false);
  const [isUpdatingReminder, setIsUpdatingReminder] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const [memoryPreferenceError, setMemoryPreferenceError] = useState<string | null>(null);
  const settingsDialogRef = React.useRef<HTMLDivElement>(null);
  const settingsTriggerRef = React.useRef<HTMLButtonElement>(null);
  const settingsOpenRef = React.useRef(settingsOpen);
  const reminderOperationInFlightRef = React.useRef(false);
  settingsOpenRef.current = settingsOpen;
  const prefersReducedMotion = useReducedMotion();
  const displayName = profileName || user?.email?.split("@")[0] || "Unknown";
  const accountInitial = displayName.trim().charAt(0).toUpperCase() || "?";
  const isAccountBusy = isDeletingAccount || isSavingProfile || isProcessingAvatar;
  const platform = getPlatformAdapter();
  const nativeControlsAvailable = platform.isNative && platform.reminders.supported;
  const isAndroidApp = nativeControlsAvailable && getNativePlatform() === "android";
  const isHomeRoute = location.pathname === "/";
  const hideGlobalChrome = isVoiceSessionActive && location.pathname === "/";
  const hideBottomNavigation = shouldHideBottomNavigation(isKeyboardOpen && bottomInset > 0) || hideGlobalChrome;
  const appVersion = (import.meta.env.VITE_APP_VERSION as string | undefined) || "1.1.8";

  React.useEffect(() => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    resetKeyboardState();
  }, [location.pathname, resetKeyboardState]);

  React.useEffect(() => {
    if (location.pathname !== "/" && isVoiceSessionActive) setVoiceSessionActive(false);
  }, [isVoiceSessionActive, location.pathname, setVoiceSessionActive]);

  const prepareNavigation = React.useCallback(() => {
    setSettingsOpen(false);
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement) activeElement.blur();
    resetKeyboardState();
    if (platform.isNative) {
      void import("@capacitor/keyboard").then(({ Keyboard }) => Keyboard.hide().catch(() => undefined));
    }
  }, [platform.isNative, resetKeyboardState]);

  const reconcileDailyReminderPreferences = React.useCallback(async (showError: boolean) => {
    if (!nativeControlsAvailable || reminderOperationInFlightRef.current) return;

    reminderOperationInFlightRef.current = true;
    setIsUpdatingReminder(true);
    if (showError) setNotificationError(null);

    try {
      const [enabledValue, storedTime, storedDays] = await Promise.all([
        nativeStorage.get(DAILY_REMINDER_STORAGE_KEY),
        nativeStorage.get(REMINDER_TIME_STORAGE_KEY),
        nativeStorage.get(REMINDER_DAYS_STORAGE_KEY),
      ]);
      const normalizedTime = normalizeReminderTime(storedTime);
      const normalizedDays = parseStoredReminderDays(storedDays);
      const { hour, minute } = parseReminderTime(normalizedTime);
      const wantsReminder = enabledValue === "true";
      let enabled = false;

      if (wantsReminder) {
        const status = await platform.reminders.getStatus();
        if (!status.permissionGranted) {
          if (showError) {
            setNotificationError("Allow notification permission to use daily reminders.");
          }
        } else {
          const scheduleMatches =
            status.schedules.length === normalizedDays.length &&
            normalizedDays.every((day) =>
              status.schedules.some(
                (schedule) =>
                  schedule.id === platform.reminders.getId(day) &&
                  schedule.day === day &&
                  schedule.hour === hour &&
                  schedule.minute === minute,
              ),
            );

          if (!scheduleMatches) {
            enabled = await platform.reminders.schedule({ hour, minute, days: normalizedDays });
            if (!enabled && showError) {
              setNotificationError("Android could not restore the daily reminder.");
            }
          } else {
            enabled = true;
          }
        }
      }

      await Promise.all([
        nativeStorage.set(REMINDER_TIME_STORAGE_KEY, normalizedTime),
        nativeStorage.set(REMINDER_DAYS_STORAGE_KEY, JSON.stringify(normalizedDays)),
      ]);
      setDailyRemindersEnabled(enabled);
      setReminderTime(normalizedTime);
      setReminderDays(normalizedDays);
    } catch (error) {
      if (showError) {
        setNotificationError(
          error instanceof Error ? error.message : "Could not refresh daily reminders.",
        );
      }
    } finally {
      reminderOperationInFlightRef.current = false;
      setIsUpdatingReminder(false);
      setReminderPreferencesReady(true);
    }
  }, [nativeControlsAvailable, platform]);

  useEffect(() => {
    void reconcileDailyReminderPreferences(false);
  }, [reconcileDailyReminderPreferences]);

  useEffect(() => {
    if (!nativeControlsAvailable) return;
    return platform.appState.subscribe(({ active }) => {
      if (active) void reconcileDailyReminderPreferences(settingsOpenRef.current);
    });
  }, [nativeControlsAvailable, platform, reconcileDailyReminderPreferences]);

  useEffect(() => {
    if (settingsOpen) void reconcileDailyReminderPreferences(true);
  }, [reconcileDailyReminderPreferences, settingsOpen]);

  const handleDailyReminderToggle = async () => {
    if (!reminderPreferencesReady || reminderOperationInFlightRef.current) return;
    reminderOperationInFlightRef.current = true;
    setIsUpdatingReminder(true);
    setNotificationError(null);
    const next = !dailyRemindersEnabled;

    try {
      if (next) {
        const nextDays = reminderDays.length ? reminderDays : [...DEFAULT_REMINDER_DAYS];
        const nextTime = normalizeReminderTime(reminderTime);
        const { hour, minute } = parseReminderTime(nextTime);
        const scheduled = await platform.reminders.schedule({ hour, minute, days: nextDays });
        if (!scheduled) {
          throw new Error("Allow notifications to turn on daily reminders.");
        }
        await Promise.all([
          nativeStorage.set(DAILY_REMINDER_STORAGE_KEY, "true"),
          nativeStorage.set(REMINDER_TIME_STORAGE_KEY, nextTime),
          nativeStorage.set(REMINDER_DAYS_STORAGE_KEY, JSON.stringify(nextDays)),
        ]);
        setReminderTime(nextTime);
        setReminderDays(nextDays);
      } else {
        await platform.reminders.cancel();
        await nativeStorage.set(DAILY_REMINDER_STORAGE_KEY, "false");
      }

      setDailyRemindersEnabled(next);
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "Could not update reminders.");
    } finally {
      reminderOperationInFlightRef.current = false;
      setIsUpdatingReminder(false);
    }
  };

  const handleTimeChange = async (newTime: string) => {
    if (reminderOperationInFlightRef.current) return;
    if (normalizeReminderTime(newTime) !== newTime) {
      setNotificationError("Choose a valid reminder time.");
      return;
    }

    reminderOperationInFlightRef.current = true;
    setIsUpdatingReminder(true);
    setNotificationError(null);
    try {
      if (dailyRemindersEnabled) {
        const { hour, minute } = parseReminderTime(newTime);
        const scheduled = await platform.reminders.schedule({ hour, minute, days: reminderDays });
        if (!scheduled) throw new Error("Could not reschedule reminders.");
      }
      await nativeStorage.set(REMINDER_TIME_STORAGE_KEY, newTime);
      setReminderTime(newTime);
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "Could not update reminder time.");
    } finally {
      reminderOperationInFlightRef.current = false;
      setIsUpdatingReminder(false);
    }
  };

  const handleDaysChange = async (newDays: number[]) => {
    if (reminderOperationInFlightRef.current) return;
    setNotificationError(null);
    const normalizedDays = normalizeReminderDays(newDays);
    if (normalizedDays.length === 0) {
      setNotificationError("Keep at least one reminder day selected.");
      return;
    }

    reminderOperationInFlightRef.current = true;
    setIsUpdatingReminder(true);
    try {
      if (dailyRemindersEnabled) {
        const { hour, minute } = parseReminderTime(reminderTime);
        const scheduled = await platform.reminders.schedule({ hour, minute, days: normalizedDays });
        if (!scheduled) throw new Error("Could not reschedule reminders.");
      }
      await nativeStorage.set(REMINDER_DAYS_STORAGE_KEY, JSON.stringify(normalizedDays));
      setReminderDays(normalizedDays);
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "Could not update reminder days.");
    } finally {
      reminderOperationInFlightRef.current = false;
      setIsUpdatingReminder(false);
    }
  };

  const handleMemoryPreferenceToggle = async () => {
    if (memoryPreferenceLoading) return;
    setMemoryPreferenceError(null);

    try {
      await updateMemoryPreference(!memoryEnabled);
    } catch (error) {
      setMemoryPreferenceError(
        error instanceof Error ? error.message : "Could not update this preference.",
      );
    }
  };

  const handleSignOut = async () => {
    setSettingsOpen(false);
    await logout();
    navigate("/login");
  };

  const handleSaveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSavingProfile(true);
    setProfileError(null);

    try {
      await updateProfileName(profileNameDraft);
      await updateProfileAvatarUrl(profileAvatarDraft);
      setProfileEditorOpen(false);
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not update profile.");
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleAvatarFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsProcessingAvatar(true);
    setProfileError(null);

    try {
      setProfileAvatarDraft(await makeAvatarDataUrl(file));
    } catch (error) {
      setProfileError(error instanceof Error ? error.message : "Could not update profile picture.");
    } finally {
      setIsProcessingAvatar(false);
    }
  };

  const handleDeleteAccount = async () => {
    setIsDeletingAccount(true);
    setDeleteError(null);

    try {
      await deleteAccount();
      setSettingsOpen(false);
      navigate("/login");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete the account.");
    } finally {
      setIsDeletingAccount(false);
    }
  };

  React.useEffect(() => {
    if (!settingsOpen) return;

    const originalOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";

    const getFocusableElements = (): HTMLElement[] => {
      if (!settingsDialogRef.current) return [];
      const elements = settingsDialogRef.current.querySelectorAll(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
      ) as NodeListOf<HTMLElement>;
      return Array.from<HTMLElement>(
        elements,
      ).filter((element) => element.offsetParent !== null && getComputedStyle(element).visibility !== "hidden");
    };

    const focusFrame = window.requestAnimationFrame(() => {
      const firstFocusable = getFocusableElements()[0];
      (firstFocusable ?? settingsDialogRef.current)?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
        return;
      }

      if (event.key !== "Tab" || !settingsDialogRef.current) return;
      const focusable = getFocusableElements();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      window.cancelAnimationFrame(focusFrame);
      (settingsTriggerRef.current ?? previouslyFocused)?.focus();
    };
  }, [settingsOpen]);

  React.useEffect(() => {
    if (settingsOpen) return;
    setProfileEditorOpen(false);
    setProfileError(null);
    setIsSavingProfile(false);
    setIsProcessingAvatar(false);
    setDeleteConfirmOpen(false);
    setDeleteError(null);
    setIsDeletingAccount(false);
    setNotificationError(null);
    setMemoryPreferenceError(null);
  }, [settingsOpen]);

  React.useEffect(() => {
    if (!settingsOpen || profileEditorOpen) return;
    setProfileNameDraft(displayName);
    setProfileAvatarDraft(profileAvatarUrl);
  }, [displayName, profileAvatarUrl, profileEditorOpen, settingsOpen]);

  React.useEffect(() => {
    if (hideGlobalChrome && settingsOpen) setSettingsOpen(false);
  }, [hideGlobalChrome, settingsOpen]);

  return (
    <div className="app-screen relative flex w-full justify-center overflow-hidden font-sans sm:px-6 sm:py-6 lg:px-10">
      <div className="app-atmosphere">
        <div className="app-grid" />
        <div className="app-orb app-orb-a left-[-10%] top-[-16%] h-[28rem] w-[28rem]" />
        <div className="app-orb app-orb-b bottom-[-18%] right-[-12%] h-[24rem] w-[24rem]" />
      </div>

      <div
        className={cn(
          "app-shell relative flex h-full w-full min-h-0 flex-col overflow-hidden ring-1 sm:max-w-3xl sm:rounded-shell sm:ring-[color:var(--app-shell-ring)] lg:max-w-6xl xl:max-w-7xl",
          isCompactPhone && "sm:max-w-md",
          isHomeRoute && "app-home-shell",
          hideGlobalChrome && "voice-session-shell",
        )}
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0px)" }}
      >
        {!hideGlobalChrome && (
          <button
            ref={settingsTriggerRef}
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
            className="touch-target absolute right-4 z-50 flex items-center justify-center overflow-hidden rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] active:scale-95"
            style={{
              top: "calc(0.75rem + env(safe-area-inset-top, 0px))",
              width: "2.4rem",
              height: "2.4rem",
              background: profileAvatarUrl ? "transparent" : "var(--app-accent-gradient)",
              boxShadow: "var(--app-accent-shadow), inset 0 1px 0 rgba(255,255,255,0.15)",
            }}
          >
            {profileAvatarUrl ? (
              <img src={profileAvatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
            ) : (
              <span className="text-[13px] font-bold text-white/90 select-none">{accountInitial}</span>
            )}
          </button>
        )}

        <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          <AnimatePresence mode={isAndroidApp ? "sync" : "wait"} initial={false}>
            <motion.div
              key={location.pathname}
              initial={prefersReducedMotion || isAndroidApp ? false : { opacity: 0, y: 8 }}
              animate={prefersReducedMotion || isAndroidApp ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={prefersReducedMotion || isAndroidApp ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: prefersReducedMotion || isAndroidApp ? 0 : 0.2, ease: "easeOut" }}
              className="relative flex min-h-0 flex-1 flex-col"
            >
              <Suspense fallback={<RouteContentFallback />}>
                <Outlet />
              </Suspense>
            </motion.div>
          </AnimatePresence>
        </main>

        <nav
          className={cn(
            "app-bottom-nav z-50 mt-auto overflow-hidden px-3 transition-all duration-200 sm:px-6",
            hideBottomNavigation
              ? "max-h-0 pb-0 pt-0 opacity-0"
              : isShortPhone
                ? "max-h-24 pb-safe-tight pt-1 opacity-100"
                : "max-h-28 pb-safe pt-2 opacity-100",
          )}
          aria-hidden={hideBottomNavigation}
          style={{ pointerEvents: hideBottomNavigation ? "none" : undefined }}
        >
          <div className="app-nav-shell mx-auto flex w-full max-w-xl items-center justify-between gap-1 rounded-[1.6rem] p-1.5">
            <NavItem to="/" end onNavigate={prepareNavigation} icon={<Home strokeWidth={1.6} className="h-5 w-5" />} label="Home" />
            <NavItem to="/breathe" onNavigate={prepareNavigation} icon={<Wind strokeWidth={1.6} className="h-5 w-5" />} label="Breathe" />
            <NavItem to="/intentions" onNavigate={prepareNavigation} icon={<Heart strokeWidth={1.6} className="h-5 w-5" />} label="Intentions" />
            <NavItem to="/confess" onNavigate={prepareNavigation} icon={<Flame strokeWidth={1.6} className="h-5 w-5" />} label="Release" />
          </div>
        </nav>

        <AnimatePresence>
          {settingsOpen && !hideGlobalChrome && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSettingsOpen(false)}
                className="app-overlay app-settings-overlay fixed inset-0 z-[70] backdrop-blur-sm"
              />

              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={isAndroidApp ? { duration: 0.18, ease: "easeOut" } : { type: "spring", stiffness: 380, damping: 40 }}
                role="dialog"
                aria-modal="true"
                aria-labelledby="settings-title"
                ref={settingsDialogRef}
                tabIndex={-1}
                className="app-panel-strong app-settings-sheet fixed inset-x-0 bottom-0 z-[80] mx-auto max-h-[92dvh] w-full overflow-y-auto rounded-t-[2rem] border-t scrollbar-hide sm:max-w-lg sm:px-0 xl:max-w-xl"
                style={{
                  bottom: "var(--app-bottom-offset)",
                  borderColor: "var(--app-card-border)",
                  maxHeight:
                    "calc(var(--app-visible-height) - max(env(safe-area-inset-top, 0px), 0.75rem))",
                  overscrollBehaviorY: "contain",
                  WebkitOverflowScrolling: "touch",
                }}
              >
                <div className="flex justify-center pb-1 pt-3">
                  <div className="h-1 w-10 rounded-full" style={{ backgroundColor: "var(--app-divider)" }} />
                </div>

                <div
                  className={cn("space-y-6 px-5 pt-2 sm:px-6", isCompactPhone ? "pb-5" : "pb-6")}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 id="settings-title" className="text-[19px] font-semibold tracking-tight app-heading">Settings</h2>
                    </div>
                    <button
                      onClick={() => setSettingsOpen(false)}
                      aria-label="Close settings"
                      className="touch-target app-secondary-button rounded-full p-2.5 transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <ProfileCapacityCard
                    isOpen={settingsOpen}
                  />

                  <section>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--app-accent-gradient)" }} />
                      <p className="app-kicker">Appearance</p>
                    </div>
                    <div className="flex gap-2">
                      {(["light", "dark", "system"] as const).map((t) => {
                        const icons = {
                          light: <Sun className="h-4 w-4" />,
                          dark: <Moon className="h-4 w-4" />,
                          system: <Monitor className="h-4 w-4" />,
                        };
                        const labels = { light: "Light", dark: "Dark", system: "System" };
                        const active = theme === t;
                        return (
                          <button
                            key={t}
                            onClick={() => setTheme(t)}
                            className="touch-target flex-1 rounded-2xl border px-3 py-3 text-[12px] font-medium transition-all"
                            style={{
                              background: active ? "var(--app-accent-soft)" : "var(--app-secondary-bg)",
                              borderColor: active ? "color-mix(in srgb, var(--app-accent) 35%, transparent)" : "var(--app-secondary-border)",
                              color: active ? "var(--app-accent)" : "var(--app-text-muted)",
                              boxShadow: active ? "0 0 0 1px color-mix(in srgb, var(--app-accent) 18%, transparent)" : "none",
                            }}
                          >
                            <div className="flex flex-col items-center gap-2">
                              {icons[t]}
                              <span>{labels[t]}</span>
                              {active && (
                                <span className="block h-1 w-4 rounded-full" style={{ background: "var(--app-accent)" }} />
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--app-accent-gradient)" }} />
                      <p className="app-kicker">Interaction</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={hapticsEnabled}
                      onClick={() => setHapticsEnabled(!hapticsEnabled)}
                      className="flex w-full items-center justify-between rounded-[1.4rem] border px-4 py-3.5 text-left transition-colors hover:bg-[color:var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
                      style={{
                        background: "var(--app-card-soft)",
                        borderColor: "var(--app-card-border)",
                      }}
                    >
                      <span className="flex items-center gap-3">
                        <span
                          className="flex h-9 w-9 items-center justify-center rounded-full"
                          style={{ background: "var(--app-accent-soft)", color: "var(--app-accent)" }}
                        >
                          {hapticsEnabled ? <Vibrate className="h-4 w-4" /> : <VibrateOff className="h-4 w-4" />}
                        </span>
                        <span>
                          <span className="app-heading block text-[14px] font-medium">Haptic feedback</span>
                          <span className="app-muted block text-[11px]">
                            Light tap vibration on supported devices.
                          </span>
                        </span>
                      </span>
                      <span
                        className="relative h-6 w-11 rounded-full border transition-colors"
                        style={{
                          background: hapticsEnabled ? "var(--app-accent)" : "var(--app-secondary-bg)",
                          borderColor: hapticsEnabled ? "var(--app-accent)" : "var(--app-secondary-border)",
                        }}
                      >
                        <span
                          className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-transform"
                          style={{
                            left: hapticsEnabled ? "1.45rem" : "0.2rem",
                          }}
                        />
                      </span>
                    </button>

                    {nativeControlsAvailable && (
                      <div className="mt-3 space-y-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={dailyRemindersEnabled}
                          aria-busy={isUpdatingReminder}
                          onClick={handleDailyReminderToggle}
                          disabled={!reminderPreferencesReady || isUpdatingReminder}
                          className="flex w-full items-center justify-between rounded-[1.4rem] border px-4 py-3.5 text-left transition-colors hover:bg-[color:var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] disabled:cursor-wait disabled:opacity-60"
                          style={{
                            background: "var(--app-card-soft)",
                            borderColor: "var(--app-card-border)",
                          }}
                        >
                          <span className="flex items-center gap-3">
                            <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--app-accent-soft)", color: "var(--app-accent)" }}>
                              {dailyRemindersEnabled ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                            </span>
                            <span>
                              <span className="app-heading block text-[14px] font-medium">Daily reminder</span>
                              <span className="app-muted block text-[11px]">A quiet reflection prompt.</span>
                            </span>
                          </span>
                          <span
                            className="relative h-6 w-11 rounded-full border transition-colors"
                            style={{
                              background: dailyRemindersEnabled ? "var(--app-accent)" : "var(--app-secondary-bg)",
                              borderColor: dailyRemindersEnabled ? "var(--app-accent)" : "var(--app-secondary-border)",
                            }}
                          >
                            <span className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-transform" style={{ left: dailyRemindersEnabled ? "1.45rem" : "0.2rem" }} />
                          </span>
                        </button>

                        <AnimatePresence>
                          {dailyRemindersEnabled && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: "auto", opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div
                                className="flex flex-col gap-3 rounded-[1.4rem] border px-4 py-3.5 mt-2"
                                style={{
                                  background: "var(--app-card-soft)",
                                  borderColor: "var(--app-card-border)",
                                }}
                              >
                                <div className="flex items-center justify-between">
                                  <span className="app-heading block text-[13px] font-medium">Time</span>
                                  <input
                                    type="time"
                                    value={reminderTime}
                                    onChange={(e) => void handleTimeChange(e.target.value)}
                                    disabled={isUpdatingReminder}
                                    aria-label="Daily reminder time"
                                    className="rounded-lg border px-2 py-1 text-[13px] app-heading focus-visible:outline-none disabled:opacity-60"
                                    style={{
                                      background: "var(--app-secondary-bg)",
                                      borderColor: "var(--app-secondary-border)",
                                    }}
                                  />
                                </div>
                                <div className="h-px w-full bg-[color:var(--app-divider)]" />
                                <div className="flex justify-between gap-1">
                                  {REMINDER_DAY_OPTIONS.map((day) => {
                                    const isSelected = reminderDays.includes(day.id);
                                    return (
                                      <button
                                        key={day.id}
                                        type="button"
                                        aria-label={`${day.name} reminder`}
                                        aria-pressed={isSelected}
                                        disabled={isUpdatingReminder}
                                        onClick={() => {
                                          const newDays = isSelected
                                            ? reminderDays.filter((d) => d !== day.id)
                                            : [...reminderDays, day.id].sort();
                                          void handleDaysChange(newDays);
                                        }}
                                        className="flex h-8 w-8 items-center justify-center rounded-full text-[12px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] disabled:opacity-60"
                                        style={{
                                          background: isSelected ? "var(--app-accent)" : "var(--app-secondary-bg)",
                                          color: isSelected ? "white" : "var(--app-text-muted)",
                                        }}
                                      >
                                        {day.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                        {notificationError && (
                          <p role="alert" className="rounded-xl px-3 py-2 text-[12px] leading-relaxed text-[color:var(--app-danger)]" style={{ background: "var(--app-danger-soft)" }}>
                            {notificationError}
                          </p>
                        )}
                      </div>
                    )}
                  </section>

                  <section>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--app-accent-gradient)" }} />
                      <p className="app-kicker">Personalization</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={memoryEnabled}
                      aria-busy={memoryPreferenceLoading}
                      onClick={() => void handleMemoryPreferenceToggle()}
                      disabled={memoryPreferenceLoading}
                      className="flex w-full items-center justify-between rounded-[1.4rem] border px-4 py-3.5 text-left transition-colors hover:bg-[color:var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)] disabled:cursor-wait disabled:opacity-60"
                      style={{
                        background: "var(--app-card-soft)",
                        borderColor: "var(--app-card-border)",
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-3 pr-3">
                        <span
                          className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full"
                          style={{ background: "var(--app-accent-soft)", color: "var(--app-accent)" }}
                        >
                          {memoryPreferenceLoading
                            ? <Loader2 className="h-4 w-4 animate-spin" />
                            : <Brain className="h-4 w-4" />}
                        </span>
                        <span>
                          <span className="app-heading block text-[14px] font-medium">Remember my preferences</span>
                          <span className="app-muted block text-[11px] leading-relaxed">
                            Save helpful context for more personal reflections.
                          </span>
                        </span>
                      </span>
                      <span
                        className="relative h-6 w-11 flex-shrink-0 rounded-full border transition-colors"
                        style={{
                          background: memoryEnabled ? "var(--app-accent)" : "var(--app-secondary-bg)",
                          borderColor: memoryEnabled ? "var(--app-accent)" : "var(--app-secondary-border)",
                        }}
                      >
                        <span
                          className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-all"
                          style={{ left: memoryEnabled ? "1.45rem" : "0.2rem" }}
                        />
                      </span>
                    </button>
                    <p className="app-muted mt-2 px-2 text-[11px] leading-relaxed">
                      When on, Bible Nova securely saves a private summary of recurring preferences and context to your account. Turning it off stops memory and clears remembered context.
                    </p>
                    {memoryPreferenceError && (
                      <p role="alert" className="mt-2 rounded-xl px-3 py-2 text-[12px] leading-relaxed text-[color:var(--app-danger)]" style={{ background: "var(--app-danger-soft)" }}>
                        {memoryPreferenceError}
                      </p>
                    )}
                  </section>

                  <section>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--app-accent-gradient)" }} />
                      <p className="app-kicker">Account</p>
                    </div>
                    <div
                      className="overflow-hidden rounded-[1.4rem] border"
                      style={{
                        background: "var(--app-card-soft)",
                        borderColor: "var(--app-card-border)",
                      }}
                    >
                      <div
                        className="flex items-center gap-3 px-4 py-3.5"
                        style={{ borderBottom: "1px solid var(--app-divider)" }}
                      >
                          <div
                          className="flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
                          style={{ background: "var(--app-accent-soft)" }}
                        >
                          {profileAvatarUrl ? (
                            <img src={profileAvatarUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="text-[13px] font-semibold app-accent">
                              {accountInitial}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[14px] font-medium app-heading">
                            {displayName}
                          </p>
                          <p className="text-[11px] app-muted">
                            {user?.email ?? "Signed in and synced"}
                          </p>
                        </div>
                        <button
                          onClick={() => {
                            setProfileEditorOpen((prev) => !prev);
                            setProfileNameDraft(displayName);
                            setProfileAvatarDraft(profileAvatarUrl);
                            setProfileError(null);
                          }}
                          disabled={isAccountBusy}
                          className="touch-target app-secondary-button flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50"
                          aria-label="Edit profile"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {profileEditorOpen && (
                        <form
                          onSubmit={handleSaveProfile}
                          className="space-y-3 px-4 py-4"
                          style={{ borderBottom: "1px solid var(--app-divider)" }}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="relative flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-full"
                              style={{ background: "var(--app-accent-soft)" }}
                            >
                              {profileAvatarDraft ? (
                                <img src={profileAvatarDraft} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <span className="text-xl font-semibold app-accent">{accountInitial}</span>
                              )}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-2">
                              <label className="touch-target app-secondary-button inline-flex cursor-pointer items-center justify-center gap-2 rounded-pill px-3 py-2 text-[12px] font-medium transition-colors">
                                <Camera className="h-3.5 w-3.5" />
                                {isProcessingAvatar ? "Processing..." : "Change Photo"}
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="sr-only"
                                  disabled={isProcessingAvatar || isSavingProfile}
                                  onChange={handleAvatarFileChange}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => setProfileAvatarDraft(null)}
                                disabled={isProcessingAvatar || isSavingProfile}
                                className="touch-target app-ghost-button rounded-pill px-3 py-2 text-[12px] font-medium transition-colors disabled:opacity-50"
                              >
                                Remove Photo
                              </button>
                            </div>
                          </div>
                          <label className="app-kicker block text-[10px]" htmlFor="profile-name">
                            Profile Name
                          </label>
                          <div className="flex gap-2">
                            <input
                              id="profile-name"
                              value={profileNameDraft}
                              onChange={(event) => setProfileNameDraft(event.target.value)}
                              disabled={isSavingProfile}
                              maxLength={40}
                              className="app-input min-w-0 flex-1 rounded-2xl px-4 py-3 text-[14px] transition-all disabled:opacity-60"
                              placeholder="Your name"
                            />
                            <button
                              type="submit"
                              disabled={isSavingProfile}
                              className="touch-target app-primary-button flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-white transition-all disabled:opacity-70"
                              aria-label="Save profile"
                            >
                              {isSavingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                            </button>
                          </div>
                          {profileError && (
                            <p role="alert" className="rounded-xl px-3 py-2 text-[12px] leading-relaxed text-[color:var(--app-danger)]" style={{ background: "var(--app-danger-soft)" }}>
                              {profileError}
                            </p>
                          )}
                        </form>
                      )}
                      <button
                        type="button"
                        onClick={handleSignOut}
                        disabled={isAccountBusy}
                        className="flex w-full items-center justify-between px-4 py-3.5 text-[color:var(--app-danger)] transition-colors hover:bg-[color:var(--app-danger-soft)]"
                        style={{ borderTop: "1px solid var(--app-divider)" }}
                      >
                        <div className="flex items-center gap-3">
                          <LogOut className="h-4 w-4" />
                          <span className="text-[14px] font-medium">Sign Out</span>
                        </div>
                        <ChevronRight className="h-4 w-4 opacity-40" />
                      </button>
                      <div style={{ borderTop: "1px solid var(--app-divider)" }}>
                        {!deleteConfirmOpen ? (
                          <button
                            onClick={() => {
                              setDeleteConfirmOpen(true);
                              setDeleteError(null);
                            }}
                            disabled={isDeletingAccount}
                            className="flex w-full items-center justify-between px-4 py-3.5 text-[color:var(--app-danger)] transition-colors hover:bg-[color:var(--app-danger-soft)] disabled:opacity-50"
                          >
                            <div className="flex items-center gap-3 text-left">
                              <Trash2 className="h-4 w-4" />
                              <div>
                                <span className="block text-[14px] font-medium">
                                  Delete Account
                                </span>
                                <span className="app-muted block text-[11px]">
                                  Remove this profile and saved reflections.
                                </span>
                              </div>
                            </div>
                            <ChevronRight className="h-4 w-4 opacity-40" />
                          </button>
                        ) : (
                          <div className="space-y-3 px-4 py-4">
                            <div className="flex items-start gap-3">
                              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-[color:var(--app-danger)]" />
                              <div>
                                <p className="text-[14px] font-semibold text-[color:var(--app-danger)]">
                                  Delete account?
                                </p>
                                <p className="app-muted mt-1 text-[12px] leading-relaxed">
                                  This removes local chats, intentions, onboarding progress, and subscription state. Signed-in account deletion also requires server support.
                                </p>
                              </div>
                            </div>
                            {deleteError && (
                              <p role="alert" className="rounded-xl px-3 py-2 text-[12px] leading-relaxed text-[color:var(--app-danger)]" style={{ background: "var(--app-danger-soft)" }}>
                                {deleteError}
                              </p>
                            )}
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setDeleteConfirmOpen(false);
                                  setDeleteError(null);
                                }}
                                disabled={isDeletingAccount}
                                className="touch-target app-secondary-button flex-1 rounded-pill px-3 py-2.5 text-[13px] font-medium transition-colors disabled:opacity-50"
                              >
                                Cancel
                              </button>
                              <button
                                onClick={handleDeleteAccount}
                                disabled={isDeletingAccount}
                                className="touch-target flex flex-1 items-center justify-center gap-2 rounded-pill px-3 py-2.5 text-[13px] font-semibold text-white transition-all disabled:opacity-70"
                                style={{ background: "var(--app-danger)" }}
                              >
                                {isDeletingAccount && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  <section>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: "var(--app-accent-gradient)" }} />
                      <p className="app-kicker">About</p>
                    </div>
                    <div
                      className="flex items-center justify-between rounded-[1.4rem] border px-4 py-3.5"
                      style={{
                        background: "var(--app-card-soft)",
                        borderColor: "var(--app-card-border)",
                      }}
                    >
                      <span className="text-[14px] app-muted">Bible Nova Companion</span>
                      <span className="text-[12px] app-soft">v{appVersion}</span>
                    </div>
                  </section>
                </div>
                <div className="h-safe-bottom" />
              </motion.div>
            </>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function NavItem({
  to,
  end = false,
  icon,
  label,
  onNavigate,
}: {
  to: string;
  end?: boolean;
  icon: React.ReactNode;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className="touch-target relative flex min-h-[58px] flex-1 flex-col items-center justify-center gap-1.5 rounded-pill py-2 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
      style={{ color: "var(--app-text-muted)" }}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.div
              layoutId="nav-pill"
              className="absolute inset-0 rounded-pill"
              style={{ background: "var(--app-nav-active)" }}
              transition={{ type: "spring", stiffness: 320, damping: 28 }}
            />
          )}
          <div
            className={cn(
              "relative z-10 transition-colors duration-200",
            )}
            style={{
              color: isActive ? "var(--app-accent)" : "var(--app-text-muted)",
            }}
          >
            {icon}
          </div>
          <span
            className="app-nav-label relative z-10 text-[13px] font-semibold tracking-wide transition-colors duration-200"
            style={{
              color: isActive ? "var(--app-accent)" : "var(--app-text-muted)",
              opacity: isActive ? 1 : undefined,
            }}
          >
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
