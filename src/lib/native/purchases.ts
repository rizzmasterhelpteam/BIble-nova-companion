import { Purchases, type PurchasesPackage } from "@revenuecat/purchases-capacitor";
import { getNativePlatform, isNativePlatform } from "./platform";

let purchasesInitialized = false;

const getRevenueCatApiKey = () => {
  const platform = getNativePlatform();
  if (platform === "ios") return import.meta.env.VITE_REVENUECAT_IOS_API_KEY?.trim();
  if (platform === "android") return import.meta.env.VITE_REVENUECAT_ANDROID_API_KEY?.trim();
  return undefined;
};

export async function initializePurchases(appUserID?: string | null) {
  if (!isNativePlatform() || purchasesInitialized) return false;

  const apiKey = getRevenueCatApiKey();
  if (!apiKey) return false;

  await Purchases.configure({
    apiKey,
    appUserID,
  });

  purchasesInitialized = true;
  return true;
}

export async function syncPurchasesUser(appUserID: string | null | undefined) {
  if (!isNativePlatform() || !appUserID) return false;

  if (!purchasesInitialized) {
    return initializePurchases(appUserID);
  }

  await Purchases.logIn({ appUserID });
  return true;
}

export async function getCurrentOffering() {
  if (!(await initializePurchases())) return null;
  const offerings = await Purchases.getOfferings();
  return offerings.current;
}

export async function purchasePackage(aPackage: PurchasesPackage) {
  if (!(await initializePurchases())) {
    throw new Error("Purchases are not configured.");
  }

  return Purchases.purchasePackage({ aPackage });
}

export async function restorePurchases() {
  if (!(await initializePurchases())) {
    throw new Error("Purchases are not configured.");
  }

  return Purchases.restorePurchases();
}
