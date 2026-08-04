import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { apiFetch, invalidateApiSession, setApiAccessToken } from "../lib/apiClient";
import { cancelNativeSubscriptionEntitlementSync } from "../lib/native/subscriptionSync";
import { storageGet, storageRemove, storageSet } from "../lib/webStorage";
import { startup } from "../lib/startup";
import { normalizeShadowNotes } from "../lib/shadowMemory";
import { useAppStorage } from "./AppStorageContext";

const PENDING_NATIVE_ENTITLEMENT_SYNC_KEY = "bible-nova-pending-native-entitlement-sync";

type AuthContextType = {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  identityKey: string | null;
  profileName: string | null;
  profileAvatarUrl: string | null;
  hasCompletedOnboarding: boolean;
  logout: () => Promise<void>;
  deleteAccount: () => Promise<void>;
  updateProfileName: (name: string) => Promise<void>;
  updateProfileAvatarUrl: (avatarUrl: string | null) => Promise<void>;
  completeOnboarding: () => void;
  shadowNotes: string | null;
  memoryEnabled: boolean;
  memoryPreferenceState: "loading" | "enabled" | "disabled";
  memoryPreferenceLoading: boolean;
  updateMemoryPreference: (enabled: boolean) => Promise<void>;
  enableMemoryWithInitialNotes: (notes: string) => Promise<void>;
  updateShadowNotes: (notes: string) => Promise<void>;
  acceptPersistedShadowNotes: (notes: string | null) => void;
};

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  isLoading: true,
  identityKey: null,
  profileName: null,
  profileAvatarUrl: null,
  hasCompletedOnboarding: false,
  logout: async () => {},
  deleteAccount: async () => {},
  updateProfileName: async () => {},
  updateProfileAvatarUrl: async () => {},
  completeOnboarding: () => {},
  shadowNotes: null,
  memoryEnabled: false,
  memoryPreferenceState: "loading",
  memoryPreferenceLoading: false,
  updateMemoryPreference: async () => {},
  enableMemoryWithInitialNotes: async () => {},
  updateShadowNotes: async () => {},
  acceptPersistedShadowNotes: () => {},
});

const AVATAR_NONE = "__none__";
type RemoteProfile = {
  display_name: string | null;
  avatar_url: string | null;
};

const loadRemoteProfile = async (userId: string) => {
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name, avatar_url")
    .eq("user_id", userId)
    .maybeSingle<RemoteProfile>();

  if (error) throw new Error(error.message);
  return data;
};

const saveRemoteProfile = async (
  userId: string,
  patch: Partial<RemoteProfile>,
) => {
  const existing = await loadRemoteProfile(userId);
  const { data, error } = await supabase
    .from("profiles")
    .upsert(
      {
        user_id: userId,
        display_name: patch.display_name ?? existing?.display_name ?? null,
        avatar_url: patch.avatar_url ?? existing?.avatar_url ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    )
    .select("display_name, avatar_url")
    .single<RemoteProfile>();

  if (error) throw new Error(error.message);
  return data;
};

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
  storageRemove(`bible-nova-companion-onboarding-answers-${id}`);
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

const getUserMetadataDisplayName = (currentUser: User | null) => {
  if (!currentUser) return null;
  const metadata = currentUser.user_metadata || {};
  return metadata.display_name || metadata.full_name || metadata.name || null;
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
  const { status: storageHydrationStatus } = useAppStorage();
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [identityKey, setIdentityKey] = useState<string | null>(null);
  const [profileName, setProfileName] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(false);
  const [shadowNotes, setShadowNotes] = useState<string | null>(null);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memoryPreferenceLoading, setMemoryPreferenceLoading] = useState(true);
  const [memoryOwnerId, setMemoryOwnerId] = useState<string | null>(null);
  const memoryRequestVersionRef = React.useRef(0);
  const activeMemoryUserIdRef = React.useRef<string | null>(null);
  activeMemoryUserIdRef.current = user?.id || null;
  const confirmedMemoryEnabled = memoryEnabled && memoryOwnerId === (user?.id || null);

  useEffect(() => {
    if (storageHydrationStatus === "loading") return;
    let isDisposed = false;
    let anonymousSignOutInFlight = false;
    let activeSessionToken: string | null = null;
    let activeUserId: string | null = null;
    let activeProfileUser: User | null = null;
    clearLegacyGuestState();
    const clearLegacyStateAfterRestore = () => {
      clearLegacyGuestState();
      syncOnboardingState(activeUserId);
      syncProfileState(activeProfileUser);
    };
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

    const hydrateRemoteProfile = async (currentUser: User, expectedToken: string) => {
      if (!isSupabaseConfigured) return;

      try {
        const remoteProfile = await loadRemoteProfile(currentUser.id);
        if (
          isDisposed ||
          activeSessionToken !== expectedToken ||
          activeUserId !== currentUser.id
        ) {
          return;
        }

        const storedName = storageGet(`bible-nova-companion-profile-name-${currentUser.id}`);
        const storedAvatarRaw = storageGet(`bible-nova-companion-profile-avatar-${currentUser.id}`);
        const avatarWasExplicitlyCleared = storedAvatarRaw === AVATAR_NONE;
        const storedAvatar = storedAvatarRaw === AVATAR_NONE ? null : storedAvatarRaw;
        const displayName =
          remoteProfile?.display_name || storedName || getUserMetadataDisplayName(currentUser);
        const avatarUrl =
          remoteProfile?.avatar_url ||
          storedAvatar ||
          (avatarWasExplicitlyCleared ? null : getUserAvatarUrl(currentUser));

        if (
          !remoteProfile ||
          remoteProfile.display_name !== (displayName || null) ||
          remoteProfile.avatar_url !== (avatarUrl || null)
        ) {
          await saveRemoteProfile(currentUser.id, {
            display_name: displayName || null,
            avatar_url: avatarUrl || null,
          });
        }

        if (
          isDisposed ||
          activeSessionToken !== expectedToken ||
          activeUserId !== currentUser.id
        ) {
          return;
        }

        if (displayName) storageSet(`bible-nova-companion-profile-name-${currentUser.id}`, displayName);
        if (avatarUrl) storageSet(`bible-nova-companion-profile-avatar-${currentUser.id}`, avatarUrl);
        setProfileName(displayName || null);
        setProfileAvatarUrl(avatarUrl || null);
      } catch (error) {
        if (!isDisposed && activeSessionToken === expectedToken && activeUserId === currentUser.id) {
          console.warn("Could not load the signed-in profile from Supabase:", error);
        }
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

    const clearActiveSession = async () => {
      if (isDisposed) return;
      setSession(null);
      setUser(null);
      activeProfileUser = null;
      activeUserId = null;
      setIdentityKey(null);
      syncOnboardingState(null);
      syncProfileState(null);
      setShadowNotes(null);
      setMemoryEnabled(false);
      setMemoryPreferenceLoading(false);
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
      activeProfileUser = currentUser;
      activeUserId = currentUser.id;
      setIdentityKey(currentUser.id);
      // Remove the former local premium cache now that EntitlementContext is
      // the only membership authority.
      storageRemove(`isSubscribed_${currentUser.id}`);
      storageRemove(`subscriptionSource_${currentUser.id}`);
      syncOnboardingState(currentUser.id);
      syncProfileState(currentUser);
      if (activeSessionToken) void hydrateRemoteProfile(currentUser, activeSessionToken);
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
        activeProfileUser = refreshedUser;
        syncProfileState(refreshedUser);
      } catch (error) {
        console.warn("Could not refresh the signed-in user in the background:", error);
      }
    };

    const applySession = async (currentSession: Session | null) => {
      if (isDisposed) return;

      const previousSessionToken = activeSessionToken;
      const previousUserId = activeUserId;
      activeSessionToken = currentSession?.access_token || null;
      const nextUserId = currentSession?.user?.id || null;
      if (previousSessionToken && (!activeSessionToken || (previousUserId && previousUserId !== nextUserId))) {
        invalidateApiSession();
        cancelNativeSubscriptionEntitlementSync();
        memoryRequestVersionRef.current += 1;
        window.dispatchEvent(new Event("bible-nova-account-shutdown"));
      }
      setApiAccessToken(activeSessionToken);
      setSession(currentSession);
      const currentUser = currentSession?.user || null;

      if (currentUser?.is_anonymous) {
        await rejectAnonymousSession();
      } else if (currentUser) {
        // The session already contains the user needed to render onboarding and
        // paywall. Do not hold the first interactive frame on a second network
        // request; refresh the signed-in profile in the background.
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
          startup.mark("auth-initial-resolved");
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

    return () => {
      isDisposed = true;
      subscription.unsubscribe();
      window.removeEventListener("bible-nova-storage-restored", clearLegacyStateAfterRestore);
    };
  }, [storageHydrationStatus]);

  useEffect(() => {
    const currentUserId = user?.id || null;
    const requestVersion = ++memoryRequestVersionRef.current;
    setShadowNotes(null);
    setMemoryEnabled(false);
    setMemoryOwnerId(null);

    if (!currentUserId || !isSupabaseConfigured) {
      setMemoryPreferenceLoading(false);
      return;
    }

    setMemoryPreferenceLoading(true);
    void apiFetch("/api/shadow-notes", {
      method: "GET",
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" },
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => ({}))) as {
          memoryEnabled?: boolean;
          shadowNotes?: string | null;
          error?: string;
        };
        if (!response.ok) {
          throw new Error(data.error || "Could not load memory preference.");
        }
        if (
          requestVersion !== memoryRequestVersionRef.current ||
          activeMemoryUserIdRef.current !== currentUserId
        ) {
          return;
        }

        const enabled = data.memoryEnabled === true;
        setMemoryEnabled(enabled);
        setMemoryOwnerId(currentUserId);
        setShadowNotes(
          enabled && typeof data.shadowNotes === "string"
            ? normalizeShadowNotes(data.shadowNotes)
            : null,
        );
      })
      .catch((error) => {
        if (
          requestVersion === memoryRequestVersionRef.current &&
          activeMemoryUserIdRef.current === currentUserId
        ) {
          console.warn("Could not load memory preference:", error);
        }
      })
      .finally(() => {
        if (
          requestVersion === memoryRequestVersionRef.current &&
          activeMemoryUserIdRef.current === currentUserId
        ) {
          setMemoryPreferenceLoading(false);
        }
      });
  }, [session?.access_token, user?.id]);

  const logout = useCallback(async () => {
    invalidateApiSession();
    cancelNativeSubscriptionEntitlementSync();
    memoryRequestVersionRef.current += 1;
    window.dispatchEvent(new Event("bible-nova-account-shutdown"));
    const pendingRaw = storageGet(PENDING_NATIVE_ENTITLEMENT_SYNC_KEY);
    try {
      const pending = pendingRaw ? JSON.parse(pendingRaw) as { userId?: string } : null;
      if (pending?.userId === user?.id) storageRemove(PENDING_NATIVE_ENTITLEMENT_SYNC_KEY);
    } catch {
      storageRemove(PENDING_NATIVE_ENTITLEMENT_SYNC_KEY);
    }
    setUser(null);
    setSession(null);
    setIdentityKey(null);
    setProfileName(null);
    setProfileAvatarUrl(null);
    setHasCompletedOnboarding(false);
    setShadowNotes(null);
    setMemoryEnabled(false);
    setMemoryOwnerId(null);
    setMemoryPreferenceLoading(false);

    if (isSupabaseConfigured) {
      await supabase.auth.signOut();
    }
  }, [user?.id]);

  const deleteAccount = useCallback(async () => {
    const id = user?.id || null;
    const accessToken = session?.access_token || null;
    invalidateApiSession();
    cancelNativeSubscriptionEntitlementSync();
    memoryRequestVersionRef.current += 1;
    window.dispatchEvent(new Event("bible-nova-account-shutdown"));

    if (user && isSupabaseConfigured) {
      if (!accessToken) {
        throw new Error("Missing active session. Please sign in again before deleting the account.");
      }

      try {
        const response = await apiFetch("/api/account", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || data.deleted !== true) {
          throw new Error(data.error || "Could not delete the account on the server.");
        }
      } catch (error) {
        // Deletion did not complete: keep this signed-in session usable.
        setApiAccessToken(accessToken);
        throw error;
      }
    }

    if (id) clearLocalIdentityData(id);

    setUser(null);
    setSession(null);
    setIdentityKey(null);
    setProfileName(null);
    setProfileAvatarUrl(null);
    setHasCompletedOnboarding(false);
    setShadowNotes(null);
    setMemoryEnabled(false);
    setMemoryOwnerId(null);
    setMemoryPreferenceLoading(false);

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
      await saveRemoteProfile(id, { display_name: trimmed });
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

    if (isSupabaseConfigured) {
      await saveRemoteProfile(id, { avatar_url: avatarUrl });
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

  const updateMemoryPreference = useCallback(async (enabled: boolean) => {
    const currentUserId = user?.id || null;
    if (!currentUserId) throw new Error("No active profile to update.");
    if (!isSupabaseConfigured) {
      throw new Error("Remembered preferences require a server connection.");
    }

    const requestVersion = ++memoryRequestVersionRef.current;
    const previousMemoryEnabled = memoryEnabled;
    const previousShadowNotes = shadowNotes;
    if (!enabled) {
      setMemoryEnabled(false);
      setShadowNotes(null);
    }
    setMemoryPreferenceLoading(true);
    try {
      const response = await apiFetch("/api/shadow-notes", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-cache",
        },
        body: JSON.stringify({ memoryEnabled: enabled }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        memoryEnabled?: boolean;
        shadowNotes?: string | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not update memory preference.");
      }
      if (
        requestVersion !== memoryRequestVersionRef.current ||
        activeMemoryUserIdRef.current !== currentUserId
      ) {
        return;
      }

      const confirmedEnabled = data.memoryEnabled === true;
      setMemoryEnabled(confirmedEnabled);
      setMemoryOwnerId(currentUserId);
      setShadowNotes(
        confirmedEnabled && typeof data.shadowNotes === "string"
          ? normalizeShadowNotes(data.shadowNotes)
          : null,
      );
    } catch (error) {
      if (
        requestVersion === memoryRequestVersionRef.current &&
        activeMemoryUserIdRef.current === currentUserId
      ) {
        setMemoryEnabled(previousMemoryEnabled);
        setShadowNotes(previousShadowNotes);
      }
      throw error;
    } finally {
      if (
        requestVersion === memoryRequestVersionRef.current &&
        activeMemoryUserIdRef.current === currentUserId
      ) {
        setMemoryPreferenceLoading(false);
      }
    }
  }, [memoryEnabled, shadowNotes, user?.id]);

  const updateShadowNotes = useCallback(async (notes: string) => {
    if (!user) throw new Error("No active profile to update.");
    if (!confirmedMemoryEnabled) {
      setShadowNotes(null);
      return;
    }
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
      const data = (await response.json().catch(() => ({}))) as {
        memoryEnabled?: boolean;
        shadowNotes?: string | null;
        error?: string;
      };
      if (!response.ok) {
        throw new Error(data.error || "Could not save shadow notes.");
      }
      if (data.memoryEnabled === false) {
        setMemoryEnabled(false);
        setShadowNotes(null);
        return;
      }
      setShadowNotes(normalizeShadowNotes(data.shadowNotes || trimmed));
      return;
    }

    setShadowNotes(normalizeShadowNotes(trimmed));
  }, [confirmedMemoryEnabled, user]);

  const enableMemoryWithInitialNotes = useCallback(async (notes: string) => {
    const currentUserId = user?.id || null;
    if (!currentUserId || !isSupabaseConfigured) {
      throw new Error("Remembered preferences require a server connection.");
    }
    const response = await apiFetch("/api/shadow-notes", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      body: JSON.stringify({ memoryEnabled: true, initialNotes: notes }),
    });
    const data = (await response.json().catch(() => ({}))) as {
      memoryEnabled?: boolean; shadowNotes?: string | null; error?: string;
    };
    if (!response.ok || data.memoryEnabled !== true) {
      throw new Error(data.error || "Could not save your memory choice.");
    }
    if (activeMemoryUserIdRef.current === currentUserId) {
      setMemoryEnabled(true);
      setMemoryOwnerId(currentUserId);
      setShadowNotes(typeof data.shadowNotes === "string" ? normalizeShadowNotes(data.shadowNotes) : null);
    }
  }, [user?.id]);

  const acceptPersistedShadowNotes = useCallback((notes: string | null) => {
    if (!confirmedMemoryEnabled) {
      setShadowNotes(null);
      return;
    }
    setShadowNotes(normalizeShadowNotes(notes));
  }, [confirmedMemoryEnabled]);

  const value = useMemo(
    () => ({
      user,
      session,
      isLoading,
      identityKey,
      profileName,
      profileAvatarUrl,
      hasCompletedOnboarding,
      logout,
      deleteAccount,
      updateProfileName,
      updateProfileAvatarUrl,
      completeOnboarding,
      shadowNotes,
      memoryEnabled: confirmedMemoryEnabled,
      memoryPreferenceState: memoryPreferenceLoading ? "loading" as const : confirmedMemoryEnabled ? "enabled" as const : "disabled" as const,
      memoryPreferenceLoading,
      updateMemoryPreference,
      enableMemoryWithInitialNotes,
      updateShadowNotes,
      acceptPersistedShadowNotes,
    }),
    [
      completeOnboarding,
      deleteAccount,
      hasCompletedOnboarding,
      identityKey,
      isLoading,
      confirmedMemoryEnabled,
      memoryPreferenceLoading,
      logout,
      profileAvatarUrl,
      profileName,
      session,
      updateProfileAvatarUrl,
      updateProfileName,
      user,
      shadowNotes,
    updateMemoryPreference, enableMemoryWithInitialNotes,
      updateShadowNotes,
      acceptPersistedShadowNotes,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
