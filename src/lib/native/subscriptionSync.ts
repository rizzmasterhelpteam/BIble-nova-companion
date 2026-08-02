import { apiFetch } from "../apiClient";
import {
  getConfiguredPlanIdForProduct,
  getConfiguredProductIdForIdentifier,
  restorePurchases,
} from "./purchases";
import { getNativePlatform, isNativePlatform } from "./platform";

export type NativeSubscriptionPurchase = {
  productIdentifier?: string;
  orderId?: string;
  purchaseToken?: string;
  purchaseDate?: string;
};

let activeSync: { userId: string; generation: number; controller: AbortController; promise: Promise<boolean> } | null = null;
let syncGeneration = 0;
const NATIVE_ENTITLEMENT_SYNC_TIMEOUT_MS = 10_000;

const withNativeEntitlementSyncTimeout = <T,>(promise: Promise<T>) =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error("Premium verification timed out."));
    }, NATIVE_ENTITLEMENT_SYNC_TIMEOUT_MS);

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

const getPurchaseTimestamp = (purchase: NativeSubscriptionPurchase) => {
  const value = Date.parse(purchase.purchaseDate || "");
  return Number.isFinite(value) ? value : 0;
};

export const selectNewestConfiguredNativePurchase = (
  purchases: NativeSubscriptionPurchase[],
) => purchases
  .filter((purchase) => Boolean(
    purchase.productIdentifier &&
    purchase.purchaseToken?.trim() &&
    getConfiguredProductIdForIdentifier(purchase.productIdentifier),
  ))
  .sort((left, right) => getPurchaseTimestamp(right) - getPurchaseTimestamp(left))[0];

const syncNativeSubscriptionEntitlement = async (controller: AbortController, isCurrent: () => boolean) => {
  if (!isNativePlatform() || getNativePlatform() !== "android") return false;

  const purchases = (await restorePurchases()) as NativeSubscriptionPurchase[];
  if (!isCurrent()) return false;
  const purchase = selectNewestConfiguredNativePurchase(purchases);
  if (!purchase?.productIdentifier) return false;

  const productId = getConfiguredProductIdForIdentifier(purchase.productIdentifier);
  if (!productId || !purchase.purchaseToken?.trim()) return false;

  const response = await apiFetch("/api/subscription/native-sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      productId,
      planId: getConfiguredPlanIdForProduct(productId),
      orderId: purchase.orderId?.trim() || undefined,
      purchaseToken: purchase.purchaseToken.trim(),
      platform: "android",
    }),
    signal: controller.signal,
  });
  const result = (await response.json().catch(() => ({}))) as {
    error?: string;
    subscription?: { accessActive?: boolean };
  };
  if (!response.ok) {
    throw new Error(result.error || "Your purchase could not be verified.");
  }
  return isCurrent() && result.subscription?.accessActive === true;
};

// Play Billing and server verification can be requested from both lifecycle
// recovery and Voice entitlement repair. Collapse simultaneous attempts so a
// single purchase is never verified repeatedly in parallel.
export const cancelNativeSubscriptionEntitlementSync = (userId?: string) => {
  if (activeSync && (!userId || activeSync.userId === userId)) {
    activeSync.controller.abort();
    activeSync = null;
  }
};

export const refreshNativeSubscriptionEntitlement = (userId: string) => {
  if (activeSync && activeSync.userId === userId) return activeSync.promise;
  cancelNativeSubscriptionEntitlementSync();
  const generation = ++syncGeneration;
  const controller = new AbortController();
  const isCurrent = () => activeSync?.userId === userId && activeSync.generation === generation && !controller.signal.aborted;
  const promise = withNativeEntitlementSyncTimeout(syncNativeSubscriptionEntitlement(controller, isCurrent))
    .finally(() => { if (isCurrent()) activeSync = null; });
  activeSync = { userId, generation, controller, promise };
  return promise;
};
