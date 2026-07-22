import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { hasActiveSubscription } from "../lib/native/purchases";
import { apiFetch } from "../lib/apiClient";
import { isNativePlatform } from "../lib/native/platform";
import { storageGet, storageRemove, storageSet } from "../lib/webStorage";
import { startup } from "../lib/startup";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  identityKey: string | null;
  profileName: string | null;
  profileAvatarUrl: string | null;
  hasCompletedOnboarding: boolean;
  isSubscribed: boolean;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  updateProfileName: (name: string) => Promise<void>;
  updateProfileAvatarUrl: (avatarUrl: string | null) => Promise<void>;
  completeOnboarding: () => void;
  subscribe: (source: SubscriptionSource) => void;
  shadowNotes: string | null;
  updateShadowNotes: (notes: string) => Promise<void>;
};

type SubscriptionSource = "native_google_play" | "native_app_store";

const isNativeSubscriptionSource = (
  source: SubscriptionSource | null,
): source is SubscriptionSource =>
  source === "native_google_play" || source === "native_app_store";

type UserSubscriptionMetadata = {
  status?: string;
  source?: string;
  trialEndsAt?: string;
  productId?: string;
  planId?: string;
  orderId?: string;
  linkedAt?: string;
  platform?: "android" | "ios";
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  identityKey: null,
  profileName: null,
  profileAvatarUrl: null,
  hasCompletedOnboarding: false,
  isSubscribed: false,
  logout: async () => {},
  deleteAccount: async () => {},
  updateProfileName: async () => {},
  updateProfileAvatarUrl: async () => {},
  completeOnboarding: () => {},
  subscribe: () => {},
  shadowNotes: null,
  updateShadowNotes: async () => {},
});

const AVATAR_NONE = "__none__";

const LEGACY_GUEST_STORAGE_KEYS = [
  "is_guest",
  "onboardingComplete_guest",
  "isSubscribed_guest",
  "subscriptionSource_guest",
  "bible-nova-companion-chat-guest",
  "bible-nova-companion-intentions-guest",
  "bible-nova-companion-profile-name-guest",
  "bible-nova-companion-profile-avatar-guest",
  "bible-nova-companion-shadow-notes-guest",
];

const clearLegacyGuestState = () => {
  LEGACY_GUEST_STORAGE_KEYS.forEach((key) => storageRemove(key));
};

const clearLocalIdentityData = (id: string) => {
  storageRemove(`bible-nova-companion-chat-${id}`);
  storageRemove(`bible-nova-companion-intentions-${id}`);
  storageRemove(`bible-nova-companion-profile-name-${id}`);
  storageRemove(`bible-nova-companion-profile-avatar-${id}`);
  storageRemove(`onboardingComplete_${id}`);
  storageRemove(`isSubscribed_${id}`);
  storageRemove(`subscriptionSource_${id}`);
  storageRemove("bible_nova_companion_onboarding_answers");
  storageRemove(`bible-nova-companion-shadow-notes-${id}`);
};

const getUserDisplayName = (currentUser: User | null) => {
  if (!currentUser) return null;
  const metadata = currentUser.user_metadata || {};
  return (
    metadata.display_name ||
    metadata.full_name ||
    metadata.name ||
    currentUser.email?.split("@")[0] ||
    null
  );
};

const getStoredProfileName = (id: string, currentUser: User | null) =>
  storageGet(`bible-nova-companion-profile-name-${id}`) || getUserDisplayName(currentUser);

const getUserAvatarUrl = (currentUser: User | null) => {
  if (!currentUser) return null;
  const metadata = currentUser.user_metadata || {};
  return metadata.avatar_url || metadata.picture || null;
};

const getStoredProfileAvatarUrl = (id: string, currentUser: User | null) => {
  const stored = storageGet(`bible-nova-companion-profile-avatar-${id}`);
  if (stored === AVATAR_NONE) return null;
  return stored || getUserAvatarUrl(currentUser);
};

const getStoredShadowNotes = (currentUser: User | null) => {
  const metadata = currentUser?.user_metadata || {};
  return metadata.shadow_notes || null;
};

const setStoredSubscriptionState = (id: string, value: boolean) => {
  storageSet(`isSubscribed_${id}`, value ? "true" : "false");
};

const setStoredSubscriptionSource = (id: string, source: SubscriptionSource) => {
  storageSet(`subscriptionSource_${id}`, source);
};

const clearStoredSubscriptionSource = (id: string) => {
  storageRemove(`subscriptionSource_${id}`);
};

const getStoredSubscriptionSource = (id: string) =>
  storageGet(`subscriptionSource_${id}`) as SubscriptionSource | null;

const getUserSubscriptionMetadata = (currentUser: User | null) =>
  (currentUser?.app_metadata?.subscription || undefined) as UserSubscriptionMetadata | undefined;

const hasActiveServerSubscription = (currentUser: User | null) => {
  const subscription = getUserSubscriptionMetadata(currentUser);
  if (!subscription || subscription.status !== "active") return false;
  if (!subscription.trialEndsAt) return true;
  const expiry = Date.parse(subscription.trialEndsAt);
  return Number.isFinite(expiry) && expiry > Date.now();
};

const AUTH_STARTUP_TIMEOUT_MS = 5000;

const withStartupTimeout = <T,>(
  promise: Promise<T>,
  fallback: T,
  label: string,
  timeoutMs = AUTH_STARTUP_TIMEOUT_MS,
) =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      console.warn(`${label} timed out. Continuing startup.`);
      resolve(fallback);
    }, timeoutMs);

    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      },
    );
  });

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [identityKey, setIdentityKey] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [shadowNotes, setShadowNotes] = useState<string | null>(null);

  useEffect(() => {
    let isDisposed = false;
    let anonymousSignOutInFlight = false;
    let activeSessionToken: string | null = null;

    clearLegacyGuestState();
    const clearLegacyStateAfterRestore = () => clearLegacyGuestState();
    window.addEventListener("bible-nova-storage-restored", clearLegacyStateAfterRestore);

    const syncOnboardingState = (userId: string | null) => {
      if (!isDisposed) {
        setHasCompletedOnboarding(
          userId ? storageGet(`onboardingComplete_${userId}`) === "true" : false,
        );
      }
    };

    const syncProfileState = (currentUser: User | null) => {
      const id = currentUser?.id || null;
      if (!isDisposed) {
        setProfileName(id ? getStoredProfileName(id, currentUser) : null);
        setProfileAvatarUrl(id ? getStoredProfileAvatarUrl(id, currentUser) : null);
      }
    };

    const syncShadowNotes = (currentUser: User | null) => {
      if (!isDisposed) {
        setShadowNotes(currentUser ? getStoredShadowNotes(currentUser) : null);
      }
    };

    const resolveCurrentUser = async (currentSession: Session | null) => {
      const fallbackUser = currentSession?.user || null;
      const accessToken = currentSession?.access_token;

      if (!accessToken) return fallbackUser;

      try {
        const {
          data: { user: refreshedUser },
          error,
        } = await withStartupTimeout(
          supabase.auth.getUser(accessToken),
          { data: { user: fallbackUser }, error: null },
          "Supabase user refresh",
          4000,
        );

        if (error) {
          console.warn("Supabase user refresh error:", error.message);
        }

        return refreshedUser || fallbackUser;
      } catch (error) {
        console.warn("Could not refresh Supabase user:", error);
        return fallbackUser;
      }
    };

    const syncSubscriptionState = async (
      currentUser: User | null,
      options?: { allowStoredNativeFallback?: boolean },
    ) => {
      const id = currentUser?.id || null;
      if (!id) {
        if (!isDisposed) setIsSubscribed(false);
        return;
      }

      const storedSubscription = storageGet(`isSubscribed_${id}`) === "true";
      const storedSubscriptionSource = getStoredSubscriptionSource(id);
      const serverSubscription = hasActiveServerSubscription(currentUser);
      let nativeSubscriptionActive = false;
      let nativeCheckCompleted = false;
      const allowStoredNativeFallback = options?.allowStoredNativeFallback === true;

      if (
        !serverSubscription &&
        storedSubscription &&
        isNativeSubscriptionSource(storedSubscriptionSource) &&
        isNativePlatform()
      ) {
        try {
          nativeSubscriptionActive = await new Promise<boolean>((resolve, reject) => {
            let settled = false;
            const timeoutId = window.setTimeout(() => {
              if (settled) return;
              settled = true;
              console.warn("Native subscription check timed out. Preserving cached premium state for now.");
              resolve(false);
            }, 2500);

            hasActiveSubscription().then(
              (value) => {
                if (settled) return;
                settled = true;
                nativeCheckCompleted = true;
                window.clearTimeout(timeoutId);
                resolve(value);
              },
              (error) => {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeoutId);
                reject(error);
              },
            );
          });
        } catch (error) {
          console.warn("Could not verify native subscription state:", error);
        }
      }

      const hasEntitlement =
        serverSubscription ||
        nativeSubscriptionActive ||
        (!nativeCheckCompleted &&
          allowStoredNativeFallback &&
          storedSubscription &&
          isNativeSubscriptionSource(storedSubscriptionSource));

      if (isDisposed) return;

      setStoredSubscriptionState(id, hasEntitlement);
      if (!hasEntitlement) clearStoredSubscriptionSource(id);
      setIsSubscribed(hasEntitlement);
    };

    const clearActiveSession = async () => {
      if (isDisposed) return;
      setSession(null);
      setUser(null);
      setIdentityKey(null);
      syncOnboardingState(null);
      syncProfileState(null);
      syncShadowNotes(null);
      await syncSubscriptionState(null);
    };

    const rejectAnonymousSession = async () => {
      if (!anonymousSignOutInFlight && isSupabaseConfigured) {
        anonymousSignOutInFlight = true;
        try {
          await supabase.auth.signOut();
        } catch (error) {
          console.warn("Could not clear the anonymous session:", error);
        } finally {
          anonymousSignOutInFlight = false;
        }
      }

      await clearActiveSession();
    };

    const applyAuthenticatedUser = async (currentUser: User) => {
      if (currentUser.is_anonymous) {
        await rejectAnonymousSession();
        return;
      }

      setUser(currentUser);
      setIdentityKey(currentUser.id);
      syncOnboardingState(currentUser.id);
      syncProfileState(currentUser);
      syncShadowNotes(currentUser);
      await syncSubscriptionState(currentUser, { allowStoredNativeFallback: true });
    };

    const refreshAuthenticatedUser = async (currentSession: Session, initialUser: User) => {
      try {
        const refreshedUser = await resolveCurrentUser(currentSession);
        if (
          isDisposed ||
          activeSessionToken !== currentSession.access_token ||
          !refreshedUser ||
          refreshedUser.is_anonymous ||
          refreshedUser.id !== initialUser.id
        ) {
          return;
        }

        setUser(refreshedUser);
        syncProfileState(refreshedUser);
        syncShadowNotes(refreshedUser);
        await syncSubscriptionState(refreshedUser);
      } catch (error) {
        console.warn("Could not refresh the signed-in user in the background:", error);
      }
    };

    const applySession = async (currentSession: Session | null) => {
      if (isDisposed) return;

      activeSessionToken = currentSession?.access_token || null;
      setSession(currentSession);
      const currentUser = currentSession?.user || null;

      if (currentUser?.is_anonymous) {
        await rejectAnonymousSession();
      } else if (currentUser) {
        // The session already contains the user needed to render onboarding and
        // paywall. Do not hold the first interactive frame on a second network
        // request; refresh profile/subscription metadata in the background.
        await applyAuthenticatedUser(currentUser);
        if (currentSession.access_token) {
          void refreshAuthenticatedUser(currentSession, currentUser);
        }
      } else {
        await clearActiveSession();
      }
    };

    if (!isSupabaseConfigured) {
      void clearActiveSession().finally(() => {
        if (!isDisposed) setIsLoading(false);
      });
      return () => {
        window.removeEventListener("bible-nova-storage-restored", clearLegacyStateAfterRestore);
      };
    }

    const initializeAuth = async () => {
      startup.mark("session-resolution-started");
      try {
        const {
          data: { session: initialSession },
          error,
        } = await withStartupTimeout(
          supabase.auth.getSession(),
          { data: { session: null }, error: null },
          "Supabase session check",
        );

        if (isDisposed) return;
        if (error) console.warn("Supabase getSession error:", error.message);
        await applySession(initialSession);
      } catch (error) {
        if (!isDisposed) console.error("Failed to get session:", error);
      } finally {
        if (!isDisposed) {
          setIsLoading(false);
          startup.mark("session-resolution-completed");
        }
      }
    };

    void initializeAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      window.setTimeout(() => {
        void applySession(nextSession).finally(() => {
          if (!isDisposed) setIsLoading(false);
        });
      }, 0);
    });

    let removeAppStateListener: (() => void) | undefined;
    if (isNativePlatform()) {
      void import("@capacitor/app").then(({ App }) => App.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;

        void supabase.auth
          .getSession()
          .then(async ({ data: { session: activeSession }, error }) => {
            if (error) throw error;
            const currentUser = await resolveCurrentUser(activeSession);
            if (currentUser?.is_anonymous) {
              await rejectAnonymousSession();
              return;
            }
            return syncSubscriptionState(currentUser);
          })
          .catch((error) => {
            console.warn("Could not refresh session while syncing subscriptions:", error);
          });
      })).then((listener) => {
        if (isDisposed) {
          void listener.remove();
          return;
        }

        removeAppStateListener = () => {
          void listener.remove();
        };
      }).catch((error) => {
        console.warn("Could not register the native session listener:", error);
      });
    }

    return () => {
      isDisposed = true;
      subscription.unsubscribe();
      removeAppStateListener?.();
      window.removeEventListener("bible-nova-storage-restored", clearLegacyStateAfterRestore);
    };
  }, []);

  const logout = useCallback(async () => {
    setUser(null);
    setSession(null);
    setIdentityKey(null);
    setProfileName(null);
    setProfileAvatarUrl(null);
    setHasCompletedOnboarding(false);
    setIsSubscribed(false);
    setShadowNotes(null);

    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    const id = user?.id || null;

    if (user && isSupabaseConfigured) {
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Missing active session. Please sign in again before deleting the account.");
      }

      const response = await apiFetch("/api/account", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || data.deleted !== true) {
        throw new Error(data.error || "Could not delete the account on the server.");
      }
    }

    if (id) clearLocalIdentityData(id);

    setUser(null);
    setSession(null);
    setIdentityKey(null);
    setProfileName(null);
    setProfileAvatarUrl(null);
    setHasCompletedOnboarding(false);
    setIsSubscribed(false);
    setShadowNotes(null);

    if (isSupabaseConfigured) {
      await supabase.auth.signOut().catch(() => undefined);
    }
  }, [session?.access_token, user?.id]);

  const updateProfileName = useCallback(async (name: string) => {
    const trimmed = name.trim().replace(/\s+/g, " ");
    const id = user?.id || null;

    if (!id) throw new Error("No active profile to update.");
    if (!trimmed) throw new Error("Profile name cannot be empty.");
    if (trimmed.length > 40) throw new Error("Profile name must be 40 characters or less.");

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.auth.updateUser({
        data: { display_name: trimmed },
      });

      if (error) throw new Error(error.message);
      setUser(data.user);
    }

    storageSet(`bible-nova-companion-profile-name-${id}`, trimmed);
    setProfileName(trimmed);
  }, [user]);

  const updateProfileAvatarUrl = useCallback(async (avatarUrl: string | null) => {
    const id = user?.id || null;
    if (!id) throw new Error("No active profile to update.");
    if (avatarUrl && avatarUrl.length > 900_000) {
      throw new Error("Profile picture is too large. Choose a smaller image.");
    }

    storageSet(`bible-nova-companion-profile-avatar-${id}`, avatarUrl || AVATAR_NONE);
    setProfileAvatarUrl(avatarUrl);
  }, [user?.id]);

  const completeOnboarding = useCallback(() => {
    const id = user?.id || null;
    if (!id) return;

    storageSet(`onboardingComplete_${id}`, "true");
    setHasCompletedOnboarding(true);
  }, [user?.id]);

  const subscribe = useCallback((source: SubscriptionSource) => {
    const id = user?.id || null;
    if (!id) return;

    // Paywall calls this only after the server has verified the purchase. On
    // the next launch, entitlement is rechecked server-side or with the store.
    setStoredSubscriptionState(id, true);
    setStoredSubscriptionSource(id, source);
    setIsSubscribed(true);
  }, [user?.id]);

  const updateShadowNotes = useCallback(async (notes: string) => {
    if (!user) throw new Error("No active profile to update.");
    const trimmed = notes.trim();
    if (!trimmed) {
      setShadowNotes(null);
      return;
    }

    if (isSupabaseConfigured) {
      const response = await apiFetch("/api/shadow-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: trimmed }),
      });
      const data = (await response.json().catch(() => ({}))) as { shadowNotes?: string; error?: string };
      if (!response.ok) {
        throw new Error(data.error || "Could not save shadow notes.");
      }
      setShadowNotes(data.shadowNotes || trimmed);
      return;
    }

    setShadowNotes(trimmed);
  }, [user]);

  const value = useMemo(
    () => ({
      user,
      session,
      isLoading,
      identityKey,
      profileName,
      profileAvatarUrl,
      hasCompletedOnboarding,
      isSubscribed,
      logout,
      deleteAccount,
      updateProfileName,
      updateProfileAvatarUrl,
      completeOnboarding,
      subscribe,
      shadowNotes,
      updateShadowNotes,
    }),
    [
      completeOnboarding,
      deleteAccount,
      hasCompletedOnboarding,
      identityKey,
      isLoading,
      isSubscribed,
      logout,
      profileAvatarUrl,
      profileName,
      session,
      subscribe,
      updateProfileAvatarUrl,
      updateProfileName,
      user,
      shadowNotes,
      updateShadowNotes,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
