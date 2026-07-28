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

let nativeEntitlementRefreshPromise: Promise<boolean> | null = null;
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

const syncNativeSubscriptionEntitlement = async () => {
  if (!isNativePlatform() || getNativePlatform() !== "android") return false;

  const purchases = (await restorePurchases()) as NativeSubscriptionPurchase[];
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
  });
  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw new Error(result.error || "Your purchase could not be verified.");
  }
  return true;
};

// Play Billing and server verification can be requested from both lifecycle
// recovery and Voice entitlement repair. Collapse simultaneous attempts so a
// single purchase is never verified repeatedly in parallel.
export const refreshNativeSubscriptionEntitlement = () => {
  if (!nativeEntitlementRefreshPromise) {
    nativeEntitlementRefreshPromise = withNativeEntitlementSyncTimeout(
      syncNativeSubscriptionEntitlement(),
    ).finally(() => {
      nativeEntitlementRefreshPromise = null;
    });
  }
  return nativeEntitlementRefreshPromise;
};
