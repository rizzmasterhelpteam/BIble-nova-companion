import React, { useEffect, useState } from "react";
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
  UserRound,
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
import { isNativePlatform } from "../lib/native/platform";
import { nativeStorage } from "../lib/native/storage";
import { cn } from "../lib/utils";
import {
  cancelDailyReflectionReminder,
  registerForPushNotifications,
  scheduleDailyReflectionReminder,
  unregisterFromPushNotifications,
} from "../lib/native/notifications";

const DAILY_REMINDER_STORAGE_KEY = "bible-nova-companion-daily-reminders";
const PUSH_STORAGE_KEY = "bible-nova-companion-push-enabled";
const PUSH_TOKEN_STORAGE_KEY = "bible-nova-companion-push-token";

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
  const { isCompactPhone, isKeyboardOpen } = useMobileViewport();
  const {
    user,
    isGuest,
    profileName,
    profileAvatarUrl,
    logout,
    deleteAccount,
    updateProfileName,
    updateProfileAvatarUrl,
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
  const [pushEnabled, setPushEnabled] = useState(false);
  const [notificationError, setNotificationError] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();
  const displayName = profileName || (isGuest ? "Guest" : user?.email?.split("@")[0] ?? "Unknown");
  const accountInitial = displayName.trim().charAt(0).toUpperCase() || "?";
  const isAccountBusy = isDeletingAccount || isSavingProfile || isProcessingAvatar;
  const nativeControlsAvailable = isNativePlatform();

  useEffect(() => {
    if (!nativeControlsAvailable) return;

    void nativeStorage
      .get(DAILY_REMINDER_STORAGE_KEY)
      .then((value) => setDailyRemindersEnabled(value === "true"))
      .catch(() => undefined);

    void nativeStorage
      .get(PUSH_STORAGE_KEY)
      .then((value) => setPushEnabled(value === "true"))
      .catch(() => undefined);
  }, [nativeControlsAvailable]);

  const handleDailyReminderToggle = async () => {
    setNotificationError(null);
    const next = !dailyRemindersEnabled;

    try {
      if (next) {
        const scheduled = await scheduleDailyReflectionReminder(8, 0);
        if (!scheduled) throw new Error("Notification permission was not granted.");
      } else {
        await cancelDailyReflectionReminder();
      }

      setDailyRemindersEnabled(next);
      await nativeStorage.set(DAILY_REMINDER_STORAGE_KEY, String(next));
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "Could not update reminders.");
    }
  };

  const handlePushToggle = async () => {
    setNotificationError(null);
    const next = !pushEnabled;

    try {
      if (next) {
        const registered = await registerForPushNotifications((token) => {
          void nativeStorage.set(PUSH_TOKEN_STORAGE_KEY, token);
        });
        if (!registered) throw new Error("Push notification permission was not granted.");
      } else {
        await unregisterFromPushNotifications();
        await nativeStorage.remove(PUSH_TOKEN_STORAGE_KEY);
      }

      setPushEnabled(next);
      await nativeStorage.set(PUSH_STORAGE_KEY, String(next));
    } catch (error) {
      setNotificationError(error instanceof Error ? error.message : "Could not update push notifications.");
    }
  };

  const handleSignOut = async () => {
    setSettingsOpen(false);
    await logout();
    navigate("/login");
  };

  const handleSwitchAccount = async () => {
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
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
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
  }, [settingsOpen]);

  React.useEffect(() => {
    if (!settingsOpen || profileEditorOpen) return;
    setProfileNameDraft(displayName);
    setProfileAvatarDraft(profileAvatarUrl);
  }, [displayName, profileAvatarUrl, profileEditorOpen, settingsOpen]);

  return (
    <div className="app-screen relative flex w-full justify-center overflow-hidden font-sans sm:px-4 sm:py-6">
      <div className="app-atmosphere">
        <div className="app-grid" />
        <div className="app-orb app-orb-a left-[-10%] top-[-16%] h-[28rem] w-[28rem]" />
        <div className="app-orb app-orb-b bottom-[-18%] right-[-12%] h-[24rem] w-[24rem]" />
      </div>

      <div
        className={cn(
          "app-shell relative flex h-full w-full min-h-0 flex-col overflow-hidden ring-1 sm:max-w-md sm:rounded-shell sm:ring-[color:var(--app-shell-ring)]",
          isCompactPhone && "sm:max-w-sm",
        )}
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0px)" }}
      >
        <button
          onClick={() => setSettingsOpen(true)}
          aria-label="Open settings"
          className="touch-target app-secondary-button absolute right-4 z-50 rounded-full p-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          style={{ top: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
        >
          <Settings2 className="h-4 w-4" />
        </button>

        <main className="relative z-10 flex min-h-0 flex-1 flex-col overflow-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
              animate={prefersReducedMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
              exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
              transition={{ duration: prefersReducedMotion ? 0 : 0.3 }}
              className="relative flex min-h-0 flex-1 flex-col"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>

        <nav
          className={cn(
            "z-50 overflow-hidden px-4 transition-all duration-200 sm:px-6",
            isKeyboardOpen ? "max-h-0 pb-0 pt-0 opacity-0" : "max-h-28 pb-safe pt-2 opacity-100",
          )}
        >
          <div className="app-nav-shell flex w-full max-w-xl items-center justify-between gap-1 rounded-shell p-1">
            <NavItem to="/" icon={<Home strokeWidth={1.6} className="h-5 w-5" />} label="Home" />
            <NavItem to="/breathe" icon={<Wind strokeWidth={1.6} className="h-5 w-5" />} label="Breathe" />
            <NavItem to="/intentions" icon={<Heart strokeWidth={1.6} className="h-5 w-5" />} label="Intentions" />
            <NavItem to="/confess" icon={<Flame strokeWidth={1.6} className="h-5 w-5" />} label="Confess" />
          </div>
        </nav>

        <AnimatePresence>
          {settingsOpen && (
            <>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                onClick={() => setSettingsOpen(false)}
                className="app-overlay absolute inset-0 z-[60] backdrop-blur-sm"
              />

              <motion.div
                initial={{ y: "100%" }}
                animate={{ y: 0 }}
                exit={{ y: "100%" }}
                transition={{ type: "spring", stiffness: 380, damping: 40 }}
                className="app-panel-strong absolute bottom-0 left-0 right-0 z-[70] max-h-[92dvh] overflow-y-auto rounded-t-[2rem] border-t scrollbar-hide"
                style={{
                  borderColor: "var(--app-card-border)",
                  maxHeight:
                    "calc(var(--app-visible-height) - max(env(safe-area-inset-top, 0px), 0.75rem))",
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
                      <p className="app-kicker">Settings</p>
                      <h2 className="mt-2 text-[18px] font-semibold tracking-tight app-heading">Shape your sanctuary</h2>
                    </div>
                    <button
                      onClick={() => setSettingsOpen(false)}
                      className="touch-target app-secondary-button rounded-full p-2 transition-colors"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <section>
                    <p className="app-kicker mb-3">Appearance</p>
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
                            }}
                          >
                            <div className="flex flex-col items-center gap-2">
                              {icons[t]}
                              {labels[t]}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </section>

                  <section>
                    <p className="app-kicker mb-3">Interaction</p>
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
                          onClick={handleDailyReminderToggle}
                          className="flex w-full items-center justify-between rounded-[1.4rem] border px-4 py-3.5 text-left transition-colors hover:bg-[color:var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
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
                              <span className="app-muted block text-[11px]">A quiet reflection prompt at 8:00 AM.</span>
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

                        <button
                          type="button"
                          role="switch"
                          aria-checked={pushEnabled}
                          onClick={handlePushToggle}
                          className="flex w-full items-center justify-between rounded-[1.4rem] border px-4 py-3.5 text-left transition-colors hover:bg-[color:var(--app-secondary-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
                          style={{
                            background: "var(--app-card-soft)",
                            borderColor: "var(--app-card-border)",
                          }}
                        >
                          <span className="flex items-center gap-3">
                            <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: "var(--app-accent-soft)", color: "var(--app-accent)" }}>
                              {pushEnabled ? <BellRing className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
                            </span>
                            <span>
                              <span className="app-heading block text-[14px] font-medium">Push notifications</span>
                              <span className="app-muted block text-[11px]">Registers this device for server-sent updates.</span>
                            </span>
                          </span>
                          <span
                            className="relative h-6 w-11 rounded-full border transition-colors"
                            style={{
                              background: pushEnabled ? "var(--app-accent)" : "var(--app-secondary-bg)",
                              borderColor: pushEnabled ? "var(--app-accent)" : "var(--app-secondary-border)",
                            }}
                          >
                            <span className="absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white transition-transform" style={{ left: pushEnabled ? "1.45rem" : "0.2rem" }} />
                          </span>
                        </button>

                        {notificationError && (
                          <p role="alert" className="rounded-xl px-3 py-2 text-[12px] leading-relaxed text-[color:var(--app-danger)]" style={{ background: "var(--app-danger-soft)" }}>
                            {notificationError}
                          </p>
                        )}
                      </div>
                    )}
                  </section>

                  <section>
                    <p className="app-kicker mb-3">Account</p>
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
                            {isGuest ? "Guest mode with local progress" : user?.email ?? "Signed in and synced"}
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
                        onClick={handleSwitchAccount}
                        disabled={isAccountBusy}
                        className="flex w-full items-center justify-between px-4 py-3.5 transition-colors hover:bg-[color:var(--app-secondary-bg)] disabled:opacity-50"
                      >
                        <div className="flex items-center gap-3 text-left">
                          <UserRound className="h-4 w-4 app-muted" />
                          <div>
                            <span className="app-heading block text-[14px] font-medium">Switch Account</span>
                            <span className="app-muted block text-[11px]">Return to login and choose another profile.</span>
                          </div>
                        </div>
                        <ChevronRight className="h-4 w-4 opacity-40" />
                      </button>
                      <button
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
                                  {isGuest ? "Delete Guest Data" : "Delete Account"}
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
                                  Delete {isGuest ? "guest data" : "account"}?
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
                    <p className="app-kicker mb-3">About</p>
                    <div
                      className="flex items-center justify-between rounded-[1.4rem] border px-4 py-3.5"
                      style={{
                        background: "var(--app-card-soft)",
                        borderColor: "var(--app-card-border)",
                      }}
                    >
                      <span className="text-[14px] app-muted">Bible Nova Companion</span>
                      <span className="text-[12px] app-soft">v1.0.0</span>
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

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      className="touch-target relative flex flex-1 flex-col items-center justify-center gap-1 rounded-pill py-1.5 transition-all duration-300"
      style={{ color: "var(--app-text-muted)" }}
    >
      {({ isActive }) => (
        <>
          {isActive && (
            <motion.div
              layoutId="nav-pill"
              className="absolute inset-0 rounded-pill"
              style={{ background: "var(--app-nav-active)" }}
              transition={{ type: "spring", stiffness: 300, damping: 25 }}
            />
          )}
          <div
            className="relative z-10 transition-transform duration-300"
            style={{
              color: isActive ? "var(--app-accent)" : "var(--app-text-muted)",
              transform: isActive ? "scale(1.05)" : "scale(1)",
            }}
          >
            {icon}
          </div>
          <span
            className="relative z-10 text-[10px] font-medium tracking-wide transition-all duration-300"
            style={{
              color: isActive ? "var(--app-accent)" : "var(--app-text-muted)",
              opacity: isActive ? 1 : 0.68,
            }}
          >
            {label}
          </span>
        </>
      )}
    </NavLink>
  );
}
