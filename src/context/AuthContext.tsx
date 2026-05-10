import React, { createContext, useContext, useEffect, useState } from "react";
import { User, Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import { apiFetch } from "../lib/apiClient";
import { syncPurchasesUser } from "../lib/native/purchases";

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
  localStorage.removeItem(`bible-nova-companion-chat-${id}`);
  localStorage.removeItem(`bible-nova-companion-intentions-${id}`);
  localStorage.removeItem(`bible-nova-companion-profile-name-${id}`);
  localStorage.removeItem(`bible-nova-companion-profile-avatar-${id}`);
  localStorage.removeItem(`onboardingComplete_${id}`);
  localStorage.removeItem(`isSubscribed_${id}`);
  localStorage.removeItem("bible_nova_companion_onboarding_answers");
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
  localStorage.getItem(`bible-nova-companion-profile-name-${id}`) ||
  getUserDisplayName(currentUser) ||
  (guest ? "Guest" : null);

const getUserAvatarUrl = (currentUser: User | null) => {
  if (!currentUser) return null;
  const metadata = currentUser.user_metadata || {};
  return metadata.avatar_url || metadata.picture || null;
};

const getStoredProfileAvatarUrl = (id: string, currentUser: User | null) => {
  const stored = localStorage.getItem(`bible-nova-companion-profile-avatar-${id}`);
  if (stored === AVATAR_NONE) return null;
  return stored || getUserAvatarUrl(currentUser);
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
    void syncPurchasesUser(user?.id).catch(() => undefined);
  }, [user?.id]);

  useEffect(() => {
    const storedGuest = localStorage.getItem("is_guest") === "true";
    if (storedGuest) {
      setIsGuest(true);
      setIdentityKey("guest");
    }

    const checkOnboardingAndSub = (userId: string | null) => {
      const id = userId || "guest";
      setHasCompletedOnboarding(localStorage.getItem(`onboardingComplete_${id}`) === "true");
      setIsSubscribed(localStorage.getItem(`isSubscribed_${id}`) === "true");
    };

    const syncProfileName = (id: string | null, currentUser: User | null, guest: boolean) => {
      setProfileName(id ? getStoredProfileName(id, currentUser, guest) : null);
      setProfileAvatarUrl(id ? getStoredProfileAvatarUrl(id, currentUser) : null);
    };

    if (!isSupabaseConfigured) {
      checkOnboardingAndSub(storedGuest ? "guest" : null);
      syncProfileName(storedGuest ? "guest" : null, null, storedGuest);
      setIsLoading(false);
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
         localStorage.removeItem("is_guest");
      } else if (storedGuest) {
         setIdentityKey("guest");
      }
      
      checkOnboardingAndSub(currentUser?.id || (storedGuest ? "guest" : null));
      syncProfileName(currentUser?.id || (storedGuest ? "guest" : null), currentUser, storedGuest && !currentUser);
      setIsLoading(false);
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
         localStorage.removeItem("is_guest");
      } else {
         const guestMode = localStorage.getItem("is_guest") === "true";
         setIsGuest(guestMode);
         setIdentityKey(guestMode ? "guest" : null);
      }
      const guestMode = localStorage.getItem("is_guest") === "true";
      checkOnboardingAndSub(currentUser?.id || (guestMode ? "guest" : null));
      syncProfileName(currentUser?.id || (guestMode ? "guest" : null), currentUser, guestMode && !currentUser);
      setIsLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const loginAsGuest = () => {
    localStorage.setItem("is_guest", "true");
    setIsGuest(true);
    setIdentityKey("guest");
    setProfileName(getStoredProfileName("guest", null, true));
    setProfileAvatarUrl(getStoredProfileAvatarUrl("guest", null));
    setHasCompletedOnboarding(localStorage.getItem(`onboardingComplete_guest`) === "true");
    setIsSubscribed(localStorage.getItem(`isSubscribed_guest`) === "true");
  };

  const logout = async () => {
    localStorage.removeItem("is_guest");
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

    localStorage.removeItem("is_guest");
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

    localStorage.setItem(`bible-nova-companion-profile-name-${id}`, trimmed);
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

    localStorage.setItem(`bible-nova-companion-profile-avatar-${id}`, avatarUrl || AVATAR_NONE);
    setProfileAvatarUrl(avatarUrl);
  };

  const completeOnboarding = () => {
    const id = user?.id || (isGuest ? "guest" : null);
    if (id) {
      localStorage.setItem(`onboardingComplete_${id}`, "true");
      setHasCompletedOnboarding(true);
    }
  };

  const subscribe = () => {
    const id = user?.id || (isGuest ? "guest" : null);
    if (id) {
      localStorage.setItem(`isSubscribed_${id}`, "true");
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
