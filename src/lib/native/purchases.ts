import {
  NativePurchases,
  PURCHASE_TYPE,
  type Product,
  type Transaction,
} from "@capgo/native-purchases";
import { getNativePlatform, isNativePlatform } from "./platform";

type SubscriptionPlan = "monthly" | "yearly";
type SubscriptionConfig = {
  productId?: string;
  androidBasePlanId?: string;
};

export type SubscriptionPackage = {
  plan: SubscriptionPlan;
  product: Product;
  productId: string;
  androidBasePlanId?: string;
};

export type SubscriptionOffering = {
  monthly?: SubscriptionPackage;
  annual?: SubscriptionPackage;
};

let billingChecked = false;
let billingSupported = false;

const normalizeConfigValue = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith("com.yourapp.")) return undefined;
  return trimmed;
};

const getSubscriptionConfigs = () => ({
  monthly: {
    productId: normalizeConfigValue(import.meta.env.VITE_IAP_MONTHLY_PRODUCT_ID),
    androidBasePlanId: normalizeConfigValue(import.meta.env.VITE_IAP_MONTHLY_BASE_PLAN_ID),
  },
  yearly: {
    productId: normalizeConfigValue(import.meta.env.VITE_IAP_YEARLY_PRODUCT_ID),
    androidBasePlanId: normalizeConfigValue(import.meta.env.VITE_IAP_YEARLY_BASE_PLAN_ID),
  },
});

const getProductIds = (configs: Record<SubscriptionPlan, SubscriptionConfig>) => {
  const ids = Object.values(configs)
    .map((entry) => entry.productId)
    .filter((value): value is string => Boolean(value));
  return [...new Set(ids)];
};

const selectProductForConfig = (
  products: Product[],
  config: SubscriptionConfig,
  isAndroid: boolean,
) => {
  if (!config.productId) return undefined;

  const candidates = products.filter((product) => {
    if (isAndroid) {
      return product.planIdentifier
        ? product.planIdentifier === config.productId
        : product.identifier === config.productId;
    }

    return product.identifier === config.productId;
  });

  if (!candidates.length) return undefined;

  if (isAndroid && config.androidBasePlanId) {
    const basePlanCandidates = candidates.filter(
      (product) => product.identifier === config.androidBasePlanId,
    );

    return (
      basePlanCandidates.find((product) => !product.offerId) ||
      basePlanCandidates[0]
    );
  }

  return candidates.find((product) => !product.offerId) || candidates[0];
};

const isActivePurchase = (purchase: Transaction) => {
  if (getNativePlatform() === "android") {
    return purchase.purchaseState === "1" || purchase.purchaseState === "PURCHASED";
  }

  if (purchase.revocationDate || purchase.subscriptionState === "revoked") return false;
  if (purchase.subscriptionState === "expired") return false;
  if (typeof purchase.isActive === "boolean") return purchase.isActive;
  if (purchase.expirationDate) return Date.parse(purchase.expirationDate) > Date.now();
  return true;
};

const assertValidSubscriptionPurchase = (
  purchase: Transaction,
  aPackage: SubscriptionPackage,
) => {
  if (purchase.productIdentifier !== aPackage.productId) {
    throw new Error("The completed purchase did not match the selected subscription.");
  }

  if (!isActivePurchase(purchase)) {
    throw new Error("The purchase was not completed.");
  }
};

export async function initializePurchases() {
  if (!isNativePlatform()) return false;
  if (billingChecked) return billingSupported;

  try {
    const result = await NativePurchases.isBillingSupported();
    billingSupported = Boolean(result.isBillingSupported);
  } catch {
    billingSupported = false;
  } finally {
    billingChecked = true;
  }

  return billingSupported;
}

export async function getCurrentOffering(): Promise<SubscriptionOffering | null> {
  if (!(await initializePurchases())) return null;

  const configs = getSubscriptionConfigs();
  const productIdentifiers = getProductIds(configs);
  if (!productIdentifiers.length) return null;

  const { products } = await NativePurchases.getProducts({
    productIdentifiers,
    productType: PURCHASE_TYPE.SUBS,
  });

  const isAndroid = getNativePlatform() === "android";
  const monthlyProduct = selectProductForConfig(products, configs.monthly, isAndroid);
  const yearlyProduct = selectProductForConfig(products, configs.yearly, isAndroid);

  return {
    monthly:
      monthlyProduct && configs.monthly.productId
        ? {
            plan: "monthly",
            product: monthlyProduct,
            productId: configs.monthly.productId,
            androidBasePlanId: configs.monthly.androidBasePlanId || monthlyProduct.identifier,
          }
        : undefined,
    annual:
      yearlyProduct && configs.yearly.productId
        ? {
            plan: "yearly",
            product: yearlyProduct,
            productId: configs.yearly.productId,
            androidBasePlanId: configs.yearly.androidBasePlanId || yearlyProduct.identifier,
          }
        : undefined,
  };
}

export async function purchasePackage(aPackage: SubscriptionPackage) {
  if (!(await initializePurchases())) {
    throw new Error("In-app purchases are not available on this device.");
  }

  const isAndroid = getNativePlatform() === "android";
  const planIdentifier = isAndroid ? aPackage.androidBasePlanId || aPackage.product.identifier : undefined;

  if (isAndroid && !planIdentifier) {
    throw new Error("Android base plan ID is missing for this subscription.");
  }

  const purchase = await NativePurchases.purchaseProduct({
    productIdentifier: aPackage.productId,
    planIdentifier,
    productType: PURCHASE_TYPE.SUBS,
    quantity: 1,
    autoAcknowledgePurchases: true,
  });

  assertValidSubscriptionPurchase(purchase, aPackage);
  return purchase;
}

export async function restorePurchases() {
  if (!(await initializePurchases())) {
    throw new Error("In-app purchases are not available on this device.");
  }

  await NativePurchases.restorePurchases();

  const configs = getSubscriptionConfigs();
  const activeProductIds = Object.values(configs)
    .map((entry) => entry.productId)
    .filter((value): value is string => Boolean(value));

  if (!activeProductIds.length) {
    throw new Error("IAP product IDs are not configured.");
  }

  const { purchases } = await NativePurchases.getPurchases({
    productType: PURCHASE_TYPE.SUBS,
    onlyCurrentEntitlements: true,
  });

  const hasMatchingActivePurchase = purchases.some(
    (purchase) =>
      activeProductIds.includes(purchase.productIdentifier) && isActivePurchase(purchase),
  );

  if (!hasMatchingActivePurchase) {
    throw new Error("No active subscriptions were found to restore.");
  }

  return purchases;
}

export async function openSubscriptionManagement() {
  if (!(await initializePurchases())) {
    throw new Error("In-app purchases are not available on this device.");
  }

  await NativePurchases.manageSubscriptions();
}
