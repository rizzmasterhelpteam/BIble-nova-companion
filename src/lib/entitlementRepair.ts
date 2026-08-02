import type { EntitlementSnapshot } from "../types/entitlement";

type InactiveEntitlementRepair = {
  serverSnapshot: EntitlementSnapshot;
  canRepair: boolean;
  restoreGooglePlayPurchase: () => Promise<boolean>;
  refetchStatus: () => Promise<EntitlementSnapshot>;
};

export type EntitlementRepairResult = {
  snapshot: EntitlementSnapshot;
  restorationError: string | null;
};

/**
 * Google Play is a best-effort repair after the server has already answered.
 * Its failure must never erase an authoritative inactive server result.
 */
export const repairInactiveEntitlement = async ({
  serverSnapshot,
  canRepair,
  restoreGooglePlayPurchase,
  refetchStatus,
}: InactiveEntitlementRepair): Promise<EntitlementRepairResult> => {
  if (serverSnapshot.active || !canRepair) {
    return { snapshot: serverSnapshot, restorationError: null };
  }

  try {
    const restored = await restoreGooglePlayPurchase();
    if (!restored) return { snapshot: serverSnapshot, restorationError: null };
    return { snapshot: await refetchStatus(), restorationError: null };
  } catch (error) {
    return {
      snapshot: serverSnapshot,
      restorationError: error instanceof Error
        ? error.message
        : "Google Play restoration could not be completed.",
    };
  }
};

export const preserveEntitlementOnServerFailure = (
  previousSnapshot: EntitlementSnapshot,
  error: unknown,
): EntitlementSnapshot => ({
  ...previousSnapshot,
  state: "unknown",
  active: previousSnapshot.active,
  error: error instanceof Error ? error.message : "Premium verification is temporarily unavailable.",
});
