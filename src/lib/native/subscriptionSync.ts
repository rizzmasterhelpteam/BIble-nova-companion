import { apiFetch } from "../apiClient";
import {
  getConfiguredPlanIdForProduct,
  getConfiguredProductIdForIdentifier,
  restorePurchases,
} from "./purchases";
import { getNativePlatform, isNativePlatform } from "./platform";

type NativePurchase = {
  productIdentifier?: string;
  orderId?: string;
  purchaseToken?: string;
};

export const refreshNativeSubscriptionEntitlement = async () => {
  if (!isNativePlatform() || getNativePlatform() !== "android") return false;

  const purchases = (await restorePurchases()) as NativePurchase[];
  const purchase = purchases.find((item) =>
    Boolean(
      item.productIdentifier &&
      getConfiguredProductIdForIdentifier(item.productIdentifier),
    ),
  );
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
