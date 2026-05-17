import React, { createContext, useContext, useEffect, useState } from "react";
import { App as CapacitorApp } from "@capacitor/app";
import { User, Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { apiFetch } from "../lib/apiClient";
import { hasActiveSubscription } from "../lib/native/purchases";
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
  subscribe: () => void;
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

const getActiveIdentityId = (userId: string | null) =>
  userId || (storageGet("is_guest") === "true" ? "guest" : null);

const setStoredSubscriptionState = (id: string, value: boolean) => {
  storageSet(`isSubscribed_${id}`, value ? "true" : "false");
};

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
    const storedGuest = storageGet("is_guest") === "true";
    if (storedGuest) {
      setIsGuest(true);
      setIdentityKey("guest");
    }

    const checkOnboardingAndSub = (userId: string | null) => {
      const id = getActiveIdentityId(userId);
      if (!id) {
        setHasCompletedOnboarding(false);
        setIsSubscribed(false);
        return;
      }

      setHasCompletedOnboarding(storageGet(`onboardingComplete_${id}`) === "true");
      setIsSubscribed(storageGet(`isSubscribed_${id}`) === "true");
    };

    const syncProfileName = (id: string | null, currentUser: User | null, guest: boolean) => {
      const activeId = getActiveIdentityId(id);
      setProfileName(activeId ? getStoredProfileName(activeId, currentUser, guest) : null);
      setProfileAvatarUrl(activeId ? getStoredProfileAvatarUrl(activeId, currentUser) : null);
    };

    const syncNativeSubscriptionState = async (userId: string | null) => {
      const id = getActiveIdentityId(userId);
      if (!isNativePlatform() || !id) return;

      try {
        const hasEntitlement = await hasActiveSubscription();
        setStoredSubscriptionState(id, hasEntitlement);
        setIsSubscribed(hasEntitlement);
      } catch (error) {
        console.warn("Could not sync native subscription state:", error);
      }
    };

    if (!isSupabaseConfigured) {
      checkOnboardingAndSub(storedGuest ? "guest" : null);
      syncProfileName(storedGuest ? "guest" : null, null, storedGuest);
      void syncNativeSubscriptionState(storedGuest ? "guest" : null).finally(() => {
        setIsLoading(false);
      });
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) {
         console.warn("Supabase getSession error:", error.message);
      }
      setSession(session);
      const currentUser = session?.user || null;
      setUser(currentUser);
      if (currentUser) {
         setIsGuest(false);
         setIdentityKey(currentUser.id);
         storageRemove("is_guest");
      } else if (storedGuest) {
         setIdentityKey("guest");
      }
      
      checkOnboardingAndSub(currentUser?.id || (storedGuest ? "guest" : null));
      syncProfileName(currentUser?.id || (storedGuest ? "guest" : null), currentUser, storedGuest && !currentUser);
      void syncNativeSubscriptionState(currentUser?.id || (storedGuest ? "guest" : null)).finally(() => {
        setIsLoading(false);
      });
    }).catch(err => {
      console.error("Failed to get session:", err);
      setIsLoading(false);
    });

    // Listen to auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      const currentUser = session?.user || null;
      setUser(currentUser);
      if (currentUser) {
         setIsGuest(false);
         setIdentityKey(currentUser.id);
         storageRemove("is_guest");
      } else {
         const guestMode = storageGet("is_guest") === "true";
         setIsGuest(guestMode);
         setIdentityKey(guestMode ? "guest" : null);
      }
      const guestMode = storageGet("is_guest") === "true";
      checkOnboardingAndSub(currentUser?.id || (guestMode ? "guest" : null));
      syncProfileName(currentUser?.id || (guestMode ? "guest" : null), currentUser, guestMode && !currentUser);
      void syncNativeSubscriptionState(currentUser?.id || (guestMode ? "guest" : null)).finally(() => {
        setIsLoading(false);
      });
    });

    let removeAppStateListener: (() => void) | undefined;
    if (isNativePlatform()) {
      void CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (!isActive) return;

        if (!isSupabaseConfigured) {
          void syncNativeSubscriptionState(getActiveIdentityId(null));
          return;
        }

        void supabase.auth
          .getSession()
          .then(({ data: { session } }) =>
            syncNativeSubscriptionState(session?.user?.id || getActiveIdentityId(null)),
          )
          .catch((error) => {
            console.warn("Could not refresh session while syncing subscriptions:", error);
          });
      }).then((listener) => {
        removeAppStateListener = () => {
          void listener.remove();
        };
      });
    }

    return () => {
      subscription.unsubscribe();
      removeAppStateListener?.();
    };
  }, []);

  const loginAsGuest = () => {
    storageSet("is_guest", "true");
    setIsGuest(true);
    setIdentityKey("guest");
    setProfileName(getStoredProfileName("guest", null, true));
    setProfileAvatarUrl(getStoredProfileAvatarUrl("guest", null));
    setHasCompletedOnboarding(storageGet(`onboardingComplete_guest`) === "true");
    setIsSubscribed(storageGet(`isSubscribed_guest`) === "true");
  };

  const logout = async () => {
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
  };

  const deleteAccount = async () => {
    const id = user?.id || (isGuest ? "guest" : null);

    if (user && isSupabaseConfigured) {
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error("Missing active session. Please sign in again before deleting the account.");
      }

      const response = await apiFetch("/api/account", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "Could not delete the account.");
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
  };

  const updateProfileName = async (name: string) => {
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
  };

  const updateProfileAvatarUrl = async (avatarUrl: string | null) => {
    const id = user?.id || (isGuest ? "guest" : null);

    if (!id) {
      throw new Error("No active profile to update.");
    }

    if (avatarUrl && avatarUrl.length > 900_000) {
      throw new Error("Profile picture is too large. Choose a smaller image.");
    }

    storageSet(`bible-nova-companion-profile-avatar-${id}`, avatarUrl || AVATAR_NONE);
    setProfileAvatarUrl(avatarUrl);
  };

  const completeOnboarding = () => {
    const id = user?.id || (isGuest ? "guest" : null);
    if (id) {
      storageSet(`onboardingComplete_${id}`, "true");
      setHasCompletedOnboarding(true);
    }
  };

  const subscribe = () => {
    const id = user?.id || (isGuest ? "guest" : null);
    if (id) {
      setStoredSubscriptionState(id, true);
      setIsSubscribed(true);
    }
  };

  return (
    <AuthContext.Provider value={{ 
      user, session, isLoading, isGuest, identityKey,
      profileName, profileAvatarUrl, hasCompletedOnboarding, isSubscribed,
      loginAsGuest, logout, deleteAccount, updateProfileName, updateProfileAvatarUrl, completeOnboarding, subscribe 
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
