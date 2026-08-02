import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "./AuthContext";
import { getPlatformAdapter } from "../lib/native/platform";
import {
  clearEntitlementCache,
  ENTITLEMENT_CACHE_TTL_MS,
  fetchEntitlementStatus,
  getProvisionalEntitlement,
} from "../lib/entitlementClient";
import type { EntitlementSnapshot } from "../types/entitlement";
import {
  preserveEntitlementOnServerFailure,
  repairInactiveEntitlement,
} from "../lib/entitlementRepair";

type EntitlementContextValue = {
  snapshot: EntitlementSnapshot;
  isRefreshing: boolean;
  restorationError: string | null;
  refresh: (force?: boolean) => Promise<EntitlementSnapshot>;
  restoreGooglePlayPurchase: () => Promise<EntitlementSnapshot>;
};

const emptySnapshot: EntitlementSnapshot = {
  state: "initializing",
  active: false,
  status: "unknown",
  source: "none",
  productId: null,
  expiresAt: null,
  verifiedAt: null,
  error: null,
};

const EntitlementContext = createContext<EntitlementContextValue>({
  snapshot: emptySnapshot,
  isRefreshing: false,
  restorationError: null,
  refresh: async () => emptySnapshot,
  restoreGooglePlayPurchase: async () => emptySnapshot,
});

export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [snapshot, setSnapshot] = useState<EntitlementSnapshot>(emptySnapshot);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [restorationError, setRestorationError] = useState<string | null>(null);
  const requestVersionRef = useRef(0);
  const activeUserIdRef = useRef<string | null>(null);
  const nativeRepairAttemptedRef = useRef<string | null>(null);
  const lastVerifiedAtRef = useRef(0);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;

  const refresh = useCallback(async (force = false) => {
    const currentUser = user;
    if (!currentUser) {
      const signedOutSnapshot = { ...emptySnapshot, state: "inactive" as const, status: "none" as const };
      setSnapshot(signedOutSnapshot);
      return signedOutSnapshot;
    }

    const userId = currentUser.id;
    const requestVersion = ++requestVersionRef.current;
    const previousSnapshot = snapshotRef.current;
    setIsRefreshing(true);
    setRestorationError(null);
    setSnapshot((current) => ({
      ...current,
      state: "refreshing",
      error: null,
    }));

    try {
      let serverSnapshot = await fetchEntitlementStatus(userId, { force });
      const canRepairNative =
        getPlatformAdapter().isNative &&
        getPlatformAdapter().kind === "android" &&
        !serverSnapshot.active &&
        nativeRepairAttemptedRef.current !== userId;

      if (canRepairNative) {
        nativeRepairAttemptedRef.current = userId;
        const repair = await repairInactiveEntitlement({
          serverSnapshot,
          canRepair: true,
          restoreGooglePlayPurchase: async () => {
            const { refreshNativeSubscriptionEntitlement } = await import("../lib/native/subscriptionSync");
            return refreshNativeSubscriptionEntitlement(userId);
          },
          refetchStatus: () => fetchEntitlementStatus(userId, { force: true, bypassInFlight: true }),
        });
        serverSnapshot = repair.snapshot;
        if (repair.restorationError && requestVersion === requestVersionRef.current && activeUserIdRef.current === userId) {
          setRestorationError(repair.restorationError);
        }
      }

      if (requestVersion !== requestVersionRef.current || activeUserIdRef.current !== userId) {
        return serverSnapshot;
      }

      lastVerifiedAtRef.current = Date.now();
      setSnapshot(serverSnapshot);
      return serverSnapshot;
    } catch (error) {
      if (requestVersion !== requestVersionRef.current || activeUserIdRef.current !== userId) {
        return previousSnapshot;
      }

      const preservedSnapshot = preserveEntitlementOnServerFailure(previousSnapshot, error);
      setSnapshot(preservedSnapshot);
      return preservedSnapshot;
    } finally {
      if (requestVersion === requestVersionRef.current) setIsRefreshing(false);
    }
  }, [user?.id]);

  useEffect(() => {
    const userId = user?.id || null;
    const previousUserId = activeUserIdRef.current;
    activeUserIdRef.current = userId;
    requestVersionRef.current += 1;
    if (previousUserId !== userId) nativeRepairAttemptedRef.current = null;
    if (previousUserId !== userId) {
      void import("../lib/native/subscriptionSync").then(({ cancelNativeSubscriptionEntitlementSync }) =>
        cancelNativeSubscriptionEntitlementSync(previousUserId || undefined),
      );
    }
    clearEntitlementCache();

    if (!userId) {
      setSnapshot({ ...emptySnapshot, state: "inactive", status: "none" });
      setIsRefreshing(false);
      return;
    }

    const provisional = getProvisionalEntitlement(user);
    const initialSnapshot = provisional || emptySnapshot;
    snapshotRef.current = initialSnapshot;
    setSnapshot(initialSnapshot);
    lastVerifiedAtRef.current = 0;
    void refresh(true);
  }, [refresh, user?.id]);

  useEffect(() => {
    const removeAppStateListener = getPlatformAdapter().appState.subscribe(({ active }) => {
      if (!active || !user?.id || Date.now() - lastVerifiedAtRef.current < ENTITLEMENT_CACHE_TTL_MS) return;
      void refresh(false);
    });
    return removeAppStateListener;
  }, [refresh, user?.id]);

  const restoreGooglePlayPurchase = useCallback(async () => {
    if (getPlatformAdapter().isNative && getPlatformAdapter().kind === "android") {
      nativeRepairAttemptedRef.current = user?.id || null;
      const { refreshNativeSubscriptionEntitlement } = await import("../lib/native/subscriptionSync");
      if (user?.id) await refreshNativeSubscriptionEntitlement(user.id);
    }
    return refresh(true);
  }, [refresh, user?.id]);

  const value = useMemo(
    () => ({ snapshot, isRefreshing, restorationError, refresh, restoreGooglePlayPurchase }),
    [isRefreshing, refresh, restorationError, restoreGooglePlayPurchase, snapshot],
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export const useEntitlement = () => useContext(EntitlementContext);
