import type { Product, Transaction } from "@capgo/native-purchases";
import { getNativePlatform, isNativePlatform } from "./platform";

type SubscriptionPlan = "monthly" | "yearly";
type SubscriptionConfig = {
  productId?: string;
  androidBasePlanId?: string;
  androidOfferId?: string;
};
type SubscriptionDefaults = Required<Pick<SubscriptionConfig, "productId" | "androidBasePlanId">> & {
  androidOfferId?: string;
};

// These are public Google Play identifiers, not secrets. Keep them as a
// fallback because Vite replaces VITE_* values at build time and a remote web
// bundle without those variables would otherwise make every native plan look
// unconfigured.
const DEFAULT_ANDROID_SUBSCRIPTION_CONFIG: Record<SubscriptionPlan, SubscriptionDefaults> = {
  monthly: {
    productId: "biblenova",
    androidBasePlanId: "monthly",
    androidOfferId: "trial",
  },
  yearly: {
    productId: "biblenovayearly",
    androidBasePlanId: "yearlyoffer",
  },
};

export type SubscriptionPackage = {
  plan: SubscriptionPlan;
  product: Product;
  baseProduct?: Product;
  productId: string;
  androidBasePlanId?: string;
};

export type SubscriptionOffering = {
  monthly?: SubscriptionPackage;
  annual?: SubscriptionPackage;
};

let billingChecked = false;
let billingSupported = false;
let billingSupportPromise: Promise<boolean> | null = null;
let nativePurchasesModulePromise: Promise<typeof import("@capgo/native-purchases") | null> | null =
  null;
const BILLING_STARTUP_TIMEOUT_MS = 8000;
const OFFERING_RETRY_DELAY_MS = 700;

const withTimeout = <T,>(promise: Promise<T>, fallback: T, timeoutMs = BILLING_STARTUP_TIMEOUT_MS) =>
  new Promise<T>((resolve, reject) => {
    let settled = false;
    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
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

const wait = (durationMs: number) =>
  new Promise<void>((resolve) => window.setTimeout(resolve, durationMs));

const getNativePurchasesModule = async () => {
  if (!isNativePlatform()) {
    return null;
  }

  if (!nativePurchasesModulePromise) {
    nativePurchasesModulePromise = import("@capgo/native-purchases")
      .then((module) => module)
      .catch(() => null);
  }

  return nativePurchasesModulePromise;
};

const normalizeConfigValue = (value?: string) => {
  const trimmed = value?.trim();
  if (!trimmed || trimmed.startsWith("com.yourapp.")) return undefined;
  return trimmed;
};

const getSubscriptionConfigs = () => ({
  monthly: {
    productId:
      normalizeConfigValue(import.meta.env.VITE_IAP_MONTHLY_PRODUCT_ID) ||
      DEFAULT_ANDROID_SUBSCRIPTION_CONFIG.monthly.productId,
    androidBasePlanId:
      normalizeConfigValue(import.meta.env.VITE_IAP_MONTHLY_BASE_PLAN_ID) ||
      DEFAULT_ANDROID_SUBSCRIPTION_CONFIG.monthly.androidBasePlanId,
    androidOfferId:
      normalizeConfigValue(import.meta.env.VITE_IAP_MONTHLY_OFFER_ID) ||
      DEFAULT_ANDROID_SUBSCRIPTION_CONFIG.monthly.androidOfferId,
  },
  yearly: {
    productId:
      normalizeConfigValue(import.meta.env.VITE_IAP_YEARLY_PRODUCT_ID) ||
      DEFAULT_ANDROID_SUBSCRIPTION_CONFIG.yearly.productId,
    androidBasePlanId:
      normalizeConfigValue(import.meta.env.VITE_IAP_YEARLY_BASE_PLAN_ID) ||
      DEFAULT_ANDROID_SUBSCRIPTION_CONFIG.yearly.androidBasePlanId,
    androidOfferId:
      normalizeConfigValue(import.meta.env.VITE_IAP_YEARLY_OFFER_ID) ||
      DEFAULT_ANDROID_SUBSCRIPTION_CONFIG.yearly.androidOfferId,
  },
});

export const getConfiguredMonthlyOfferId = () => getSubscriptionConfigs().monthly.androidOfferId;

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
      return (
        product.planIdentifier === config.productId ||
        product.identifier === config.productId
      );
    }

    return product.identifier === config.productId;
  });

  if (!candidates.length) return undefined;

  if (isAndroid && config.androidBasePlanId) {
    const basePlanCandidates = candidates.filter(
      (product) => product.identifier === config.androidBasePlanId,
    );

    const preferredOffer = basePlanCandidates.find(
      (product) => product.offerId === config.androidOfferId,
    );

    if (preferredOffer) return preferredOffer;

    return (
      basePlanCandidates.find((product) => !product.offerId) ||
      basePlanCandidates[0]
    );
  }

  return candidates.find((product) => !product.offerId) || candidates[0];
};

const selectBasePlanProduct = (products: Product[], config: SubscriptionConfig) => {
  if (!config.productId || !config.androidBasePlanId) return undefined;

  return products.find(
    (product) =>
      product.planIdentifier === config.productId &&
      product.identifier === config.androidBasePlanId &&
      !product.offerId,
  );
};

const isActivePurchase = (purchase: Transaction) => {
  if (getNativePlatform() === "android" && purchase.purchaseState) {
    return purchase.purchaseState === "1" || purchase.purchaseState === "PURCHASED";
  }

  if (purchase.revocationDate || purchase.subscriptionState === "revoked") return false;
  if (purchase.subscriptionState === "expired") return false;
  if (typeof purchase.isActive === "boolean") return purchase.isActive;
  if (purchase.expirationDate) return Date.parse(purchase.expirationDate) > Date.now();
  return true;
};

const getConfiguredProductIds = () => {
  const configs = getSubscriptionConfigs();
  return Object.values(configs)
    .map((entry) => entry.productId)
    .filter((value): value is string => Boolean(value));
};

export const getConfiguredProductIdForIdentifier = (identifier: string) => {
  const normalizedIdentifier = identifier.trim();
  if (!normalizedIdentifier) return undefined;

  const match = Object.values(getSubscriptionConfigs()).find(
    (entry) =>
      entry.productId === normalizedIdentifier ||
      entry.androidBasePlanId === normalizedIdentifier,
  );

  return match?.productId;
};

export const getConfiguredPlanIdForProduct = (productId: string) => {
  const configs = getSubscriptionConfigs();
  const match = Object.values(configs).find(
    (entry) => entry.productId === productId || entry.androidBasePlanId === productId,
  );
  return match?.androidBasePlanId;
};

const assertValidSubscriptionPurchase = (
  purchase: Transaction,
  aPackage: SubscriptionPackage,
) => {
  if (getConfiguredProductIdForIdentifier(purchase.productIdentifier) !== aPackage.productId) {
    throw new Error("The completed purchase did not match the selected subscription.");
  }

  if (!isActivePurchase(purchase)) {
    throw new Error("The purchase was not completed.");
  }
};

export async function initializePurchases() {
  const nativePurchasesModule = await getNativePurchasesModule();
  if (!nativePurchasesModule) return false;
  if (billingChecked && billingSupported) return true;
  if (billingSupportPromise) return billingSupportPromise;

  billingSupportPromise = (async () => {
    try {
      const result = await withTimeout(
        nativePurchasesModule.NativePurchases.isBillingSupported(),
        { isBillingSupported: false },
      );
      billingSupported = Boolean(result.isBillingSupported);
      // Do not permanently cache a transient false response. Google Play can
      // become ready shortly after the app process starts.
      billingChecked = billingSupported;
      return billingSupported;
    } catch {
      billingSupported = false;
      billingChecked = false;
      return false;
    } finally {
      billingSupportPromise = null;
    }
  })();

  return billingSupportPromise;
}

export async function getCurrentOffering(): Promise<SubscriptionOffering | null> {
  const nativePurchasesModule = await getNativePurchasesModule();
  if (!nativePurchasesModule) return null;

  const configs = getSubscriptionConfigs();
  const productIdentifiers = getProductIds(configs);
  if (!productIdentifiers.length) return null;

  let lastError: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      if (!(await initializePurchases())) {
        throw new Error("Google Play billing is still starting. Please try again.");
      }

      const result = await withTimeout(
        nativePurchasesModule.NativePurchases.getProducts({
          productIdentifiers,
          productType: nativePurchasesModule.PURCHASE_TYPE.SUBS,
        }),
        null,
      );

      if (!result?.products?.length) {
        throw new Error("Google Play did not return subscription products yet.");
      }

      const products = result.products;
      const isAndroid = getNativePlatform() === "android";
      const monthlyProduct = selectProductForConfig(products, configs.monthly, isAndroid);
      const yearlyProduct = selectProductForConfig(products, configs.yearly, isAndroid);
      const monthlyBaseProduct = selectBasePlanProduct(products, configs.monthly);
      const yearlyBaseProduct = selectBasePlanProduct(products, configs.yearly);
      const offering = {
        monthly:
          monthlyProduct && configs.monthly.productId
            ? {
                plan: "monthly" as const,
                product: monthlyProduct,
                baseProduct: monthlyBaseProduct,
                productId: configs.monthly.productId,
                androidBasePlanId: configs.monthly.androidBasePlanId || monthlyProduct.identifier,
              }
            : undefined,
        annual:
          yearlyProduct && configs.yearly.productId
            ? {
                plan: "yearly" as const,
                product: yearlyProduct,
                baseProduct: yearlyBaseProduct,
                productId: configs.yearly.productId,
                androidBasePlanId: configs.yearly.androidBasePlanId || yearlyProduct.identifier,
              }
            : undefined,
      } satisfies SubscriptionOffering;

      if (offering.monthly || offering.annual) return offering;
      throw new Error("Google Play returned products, but none matched the configured plans.");
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Could not load Google Play products.");
      if (attempt === 0) await wait(OFFERING_RETRY_DELAY_MS);
    }
  }

  throw lastError || new Error("Could not load Google Play subscription products.");
}

export async function purchasePackage(aPackage: SubscriptionPackage) {
  const nativePurchasesModule = await getNativePurchasesModule();
  if (!nativePurchasesModule || !(await initializePurchases())) {
    throw new Error("In-app purchases are not available on this device.");
  }

  const isAndroid = getNativePlatform() === "android";
  const planIdentifier = isAndroid ? aPackage.androidBasePlanId || aPackage.product.identifier : undefined;
  const offerId = isAndroid ? aPackage.product.offerId || undefined : undefined;

  if (isAndroid && !planIdentifier) {
    throw new Error("Android base plan ID is missing for this subscription.");
  }

  const purchase = await nativePurchasesModule.NativePurchases.purchaseProduct({
    productIdentifier: aPackage.productId,
    planIdentifier,
    productType: nativePurchasesModule.PURCHASE_TYPE.SUBS,
    quantity: 1,
    autoAcknowledgePurchases: true,
    ...(offerId ? { offerId } : {}),
  } as Parameters<typeof nativePurchasesModule.NativePurchases.purchaseProduct>[0] & {
    offerId?: string;
  });

  assertValidSubscriptionPurchase(purchase, aPackage);
  return purchase;
}

export async function restorePurchases() {
  const nativePurchasesModule = await getNativePurchasesModule();
  if (!nativePurchasesModule || !(await initializePurchases())) {
    throw new Error("In-app purchases are not available on this device.");
  }

  await nativePurchasesModule.NativePurchases.restorePurchases();

  const activeProductIds = getConfiguredProductIds();

  if (!activeProductIds.length) {
    throw new Error("IAP product IDs are not configured.");
  }

  const { purchases } = await nativePurchasesModule.NativePurchases.getPurchases({
    productType: nativePurchasesModule.PURCHASE_TYPE.SUBS,
    onlyCurrentEntitlements: true,
  });

  const hasMatchingActivePurchase = purchases.some(
    (purchase) =>
      activeProductIds.includes(getConfiguredProductIdForIdentifier(purchase.productIdentifier) || "") &&
      isActivePurchase(purchase),
  );

  if (!hasMatchingActivePurchase) {
    throw new Error("No active subscriptions were found to restore.");
  }

  return purchases;
}

export async function hasActiveSubscription() {
  const nativePurchasesModule = await getNativePurchasesModule();
  if (!nativePurchasesModule || !(await initializePurchases())) return false;

  const activeProductIds = getConfiguredProductIds();
  if (!activeProductIds.length) return false;

  const { purchases } = await withTimeout(
    nativePurchasesModule.NativePurchases.getPurchases({
      productType: nativePurchasesModule.PURCHASE_TYPE.SUBS,
      onlyCurrentEntitlements: true,
    }),
    { purchases: [] as Transaction[] },
  );

  return purchases.some(
    (purchase) =>
      activeProductIds.includes(getConfiguredProductIdForIdentifier(purchase.productIdentifier) || "") &&
      isActivePurchase(purchase),
  );
}

export async function openSubscriptionManagement() {
  const nativePurchasesModule = await getNativePurchasesModule();
  if (!nativePurchasesModule || !(await initializePurchases())) {
    throw new Error("In-app purchases are not available on this device.");
  }

  await nativePurchasesModule.NativePurchases.manageSubscriptions();
}
