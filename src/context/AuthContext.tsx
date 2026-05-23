import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { User, Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { hasActiveSubscription } from "../lib/native/purchases";
import { apiFetch } from "../lib/apiClient";
import { isNativePlatform } from "../lib/native/platform";
import { storageGet, storageRemove, storageSet } from "../lib/webStorage";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isGuest: boolean;
  identityKey: string | null;
  profileName: string | null;
  profileAvatarUrl: string | null;
  hasCompletedOnboarding: boolean;
  isSubscribed: boolean;
  loginAsGuest: () => void;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  updateProfileName: (name: string) => Promise<void>;
  updateProfileAvatarUrl: (avatarUrl: string | null) => Promise<void>;
  completeOnboarding: () => void;
  subscribe: (source: SubscriptionSource) => void;
};

type SubscriptionSource =
  | "native_google_play"
  | "native_app_store";

const isNativeSubscriptionSource = (
  source: SubscriptionSource | null,
): source is "native_google_play" | "native_app_store" =>
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
  isGuest: false,
  identityKey: null,
  profileName: null,
  profileAvatarUrl: null,
  hasCompletedOnboarding: false,
  isSubscribed: false,
  loginAsGuest: () => {},
  logout: async () => {},
  deleteAccount: async () => {},
  updateProfileName: async () => {},
  updateProfileAvatarUrl: async () => {},
  completeOnboarding: () => {},
  subscribe: () => {},
});

const AVATAR_NONE = "__none__";

const clearLocalIdentityData = (id: string) => {
  storageRemove(`bible-nova-companion-chat-${id}`);
  storageRemove(`bible-nova-companion-intentions-${id}`);
  storageRemove(`bible-nova-companion-profile-name-${id}`);
  storageRemove(`bible-nova-companion-profile-avatar-${id}`);
  storageRemove(`onboardingComplete_${id}`);
  storageRemove(`isSubscribed_${id}`);
  storageRemove(`subscriptionSource_${id}`);
  storageRemove("bible_nova_companion_onboarding_answers");
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

const getStoredProfileName = (id: string, currentUser: User | null, guest: boolean) =>
  storageGet(`bible-nova-companion-profile-name-${id}`) ||
  getUserDisplayName(currentUser) ||
  (guest ? "Guest" : null);

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

const getActiveIdentityId = (userId: string | null) => userId;

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

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGuest, setIsGuest] = useState(false);
  const [identityKey, setIdentityKey] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);

  useEffect(() => {
    let isDisposed = false;
    const hadLegacyGuestState = storageGet("is_guest") === "true";
    if (hadLegacyGuestState) {
      clearLocalIdentityData("guest");
      storageRemove("is_guest");
    }

    const syncOnboardingState = (userId: string | null) => {
      const id = getActiveIdentityId(userId);
      if (!id) {
        if (!isDisposed) {
          setHasCompletedOnboarding(false);
        }
        return;
      }

      if (!isDisposed) {
        setHasCompletedOnboarding(storageGet(`onboardingComplete_${id}`) === "true");
      }
    };

    const syncProfileName = (id: string | null, currentUser: User | null, guest: boolean) => {
      const activeId = getActiveIdentityId(id);
      if (!isDisposed) {
        setProfileName(activeId ? getStoredProfileName(activeId, currentUser, guest) : null);
        setProfileAvatarUrl(activeId ? getStoredProfileAvatarUrl(activeId, currentUser) : null);
      }
    };

    const resolveCurrentUser = async (currentSession: Session | null) => {
      const fallbackUser = currentSession?.user || null;
      const accessToken = currentSession?.access_token;

      if (!accessToken) {
        return fallbackUser;
      }

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

    const syncSubscriptionState = async (currentUser: User | null, fallbackIdentityId: string | null) => {
      const id = getActiveIdentityId(currentUser?.id || fallbackIdentityId);
      if (!id) {
        if (!isDisposed) {
          setIsSubscribed(false);
        }
        return;
      }

      const storedSubscription = storageGet(`isSubscribed_${id}`) === "true";
      const storedSubscriptionSource = getStoredSubscriptionSource(id);
      const serverSubscription = hasActiveServerSubscription(currentUser);
      const shouldTrustStoredSubscription =
        storedSubscription && !currentUser;
      let nativeSubscriptionActive = false;

      if (!serverSubscription && storedSubscription && isNativeSubscriptionSource(storedSubscriptionSource) && isNativePlatform()) {
        try {
          nativeSubscriptionActive = await hasActiveSubscription();
        } catch (error) {
          console.warn("Could not verify native subscription state:", error);
        }
      }

      const hasEntitlement =
        serverSubscription ||
        nativeSubscriptionActive ||
        (shouldTrustStoredSubscription && storedSubscription);

      if (isDisposed) return;
      setStoredSubscriptionState(id, hasEntitlement);
      if (!hasEntitlement) {
        clearStoredSubscriptionSource(id);
      }
      setIsSubscribed(hasEntitlement);
    };

    if (!isSupabaseConfigured) {
      setIsGuest(false);
      setIdentityKey(null);
      syncOnboardingState(null);
      syncProfileName(null, null, false);
      void syncSubscriptionState(null, null).finally(() => {
        if (!isDisposed) {
          setIsLoading(false);
        }
      });
      return;
    }

    const initializeAuth = async () => {
      try {
        const {
          data: { session },
          error,
        } = await withStartupTimeout(
          supabase.auth.getSession(),
          { data: { session: null }, error: null },
          "Supabase session check",
        );
        if (isDisposed) return;

        if (error) {
          console.warn("Supabase getSession error:", error.message);
        }

        setSession(session);
        const currentUser = await resolveCurrentUser(session);
        if (isDisposed) return;
        setUser(currentUser);
        if (currentUser) {
          setIsGuest(false);
          setIdentityKey(currentUser.id);
          storageRemove("is_guest");
        } else {
          setIsGuest(false);
          setIdentityKey(null);
        }

        syncOnboardingState(currentUser?.id || null);
        syncProfileName(currentUser?.id || null, currentUser, false);
        await syncSubscriptionState(currentUser, null);
      } catch (err) {
        if (!isDisposed) {
          console.error("Failed to get session:", err);
        }
      } finally {
        if (!isDisposed) {
          setIsLoading(false);
        }
      }
    };

    void initializeAuth();

    // Listen to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void (async () => {
        setSession(session);
        const currentUser = await resolveCurrentUser(session);
        if (isDisposed) return;

        setUser(currentUser);
        if (currentUser) {
          setIsGuest(false);
          setIdentityKey(currentUser.id);
          storageRemove("is_guest");
        } else {
          setIsGuest(false);
          setIdentityKey(null);
        }

        syncOnboardingState(currentUser?.id || null);
        syncProfileName(currentUser?.id || null, currentUser, false);
        await syncSubscriptionState(currentUser, null);

        if (!isDisposed) {
          setIsLoading(false);
        }
      })();
    });

    let removeAppStateListener: (() => void) | undefined;
    if (isNativePlatform()) {
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;

        if (!isSupabaseConfigured) {
          void syncSubscriptionState(null, getActiveIdentityId(null));
          return;
        }

        void supabase.auth
          .getSession()
          .then(async ({ data: { session }, error }) => {
            if (error) {
              throw error;
            }

            const currentUser = await resolveCurrentUser(session);
            return syncSubscriptionState(currentUser, getActiveIdentityId(null));
          })
          .catch((error) => {
            console.warn("Could not refresh session while syncing subscriptions:", error);
          });
      }).then((listener) => {
        if (isDisposed) {
          void listener.remove();
          return;
        }

        removeAppStateListener = () => {
          void listener.remove();
        };
      });
    }

    return () => {
      isDisposed = true;
      subscription.unsubscribe();
      removeAppStateListener?.();
    };
  }, []);

  const loginAsGuest = useCallback(() => {
    storageRemove("is_guest");
    clearLocalIdentityData("guest");
    setUser(null);
    setSession(null);
    setIsGuest(false);
    setIdentityKey(null);
    setProfileName(null);
    setProfileAvatarUrl(null);
    setHasCompletedOnboarding(false);
    setIsSubscribed(false);
  }, []);

  const logout = useCallback(async () => {
    storageRemove("is_guest");
    setIsGuest(false);
    setIdentityKey(null);
    setProfileName(null);
    setProfileAvatarUrl(null);
    setHasCompletedOnboarding(false);
    setIsSubscribed(false);
    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
  }, []);

  const deleteAccount = useCallback(async () => {
    const id = user?.id || (isGuest ? "guest" : null);

    if (user && isSupabaseConfigured) {
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Missing active session. Please sign in again before deleting the account.");
      }

      try {
        const response = await apiFetch("/api/account", {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          console.warn("Backend account deletion failed:", data.error || "Could not delete the account on server.");
        }
      } catch (err) {
        console.warn("Could not reach backend for account deletion, proceeding with local wipe.", err);
      }
    }

    if (id) {
      clearLocalIdentityData(id);
    }

    storageRemove("is_guest");
    setUser(null);
    setSession(null);
    setIsGuest(false);
    setIdentityKey(null);
    setProfileName(null);
    setProfileAvatarUrl(null);
    setHasCompletedOnboarding(false);
    setIsSubscribed(false);

    if (isSupabaseConfigured) {
      await supabase.auth.signOut().catch(() => undefined);
    }
  }, [isGuest, session?.access_token, user?.id]);

  const updateProfileName = useCallback(async (name: string) => {
    const trimmed = name.trim().replace(/\s+/g, " ");
    const id = user?.id || (isGuest ? "guest" : null);

    if (!id) {
      throw new Error("No active profile to update.");
    }

    if (!trimmed) {
      throw new Error("Profile name cannot be empty.");
    }

    if (trimmed.length > 40) {
      throw new Error("Profile name must be 40 characters or less.");
    }

    if (user && isSupabaseConfigured) {
      const { data, error } = await supabase.auth.updateUser({
        data: { display_name: trimmed },
      });

      if (error) {
        throw new Error(error.message);
      }

      setUser(data.user);
    }

    storageSet(`bible-nova-companion-profile-name-${id}`, trimmed);
    setProfileName(trimmed);
  }, [isGuest, user]);

  const updateProfileAvatarUrl = useCallback(async (avatarUrl: string | null) => {
    const id = user?.id || (isGuest ? "guest" : null);

    if (!id) {
      throw new Error("No active profile to update.");
    }

    if (avatarUrl && avatarUrl.length > 900_000) {
      throw new Error("Profile picture is too large. Choose a smaller image.");
    }

    storageSet(`bible-nova-companion-profile-avatar-${id}`, avatarUrl || AVATAR_NONE);
    setProfileAvatarUrl(avatarUrl);
  }, [isGuest, user?.id]);

  const completeOnboarding = useCallback(() => {
    const id = user?.id || (isGuest ? "guest" : null);
    if (id) {
      storageSet(`onboardingComplete_${id}`, "true");
      setHasCompletedOnboarding(true);
    }
  }, [isGuest, user?.id]);

  const subscribe = useCallback((source: SubscriptionSource) => {
    const id = user?.id || (isGuest ? "guest" : null);
    if (id) {
      setStoredSubscriptionState(id, true);
      setStoredSubscriptionSource(id, source);
      setIsSubscribed(true);
    }
  }, [isGuest, user]);

  const value = useMemo(
    () => ({
      user,
      session,
      isLoading,
      isGuest,
      identityKey,
      profileName,
      profileAvatarUrl,
      hasCompletedOnboarding,
      isSubscribed,
      loginAsGuest,
      logout,
      deleteAccount,
      updateProfileName,
      updateProfileAvatarUrl,
      completeOnboarding,
      subscribe,
    }),
    [
      completeOnboarding,
      deleteAccount,
      hasCompletedOnboarding,
      identityKey,
      isGuest,
      isLoading,
      isSubscribed,
      loginAsGuest,
      logout,
      profileAvatarUrl,
      profileName,
      session,
      subscribe,
      updateProfileAvatarUrl,
      updateProfileName,
      user,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
