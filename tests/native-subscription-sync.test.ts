import { describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/apiClient", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("../src/lib/native/purchases", () => ({
  getConfiguredPlanIdForProduct: (productId: string) => productId === "biblenovayearly" ? "yearlyoffer" : "monthly",
  getConfiguredProductIdForIdentifier: (identifier: string) => (
    identifier === "biblenova" || identifier === "biblenovayearly" ? identifier : undefined
  ),
  restorePurchases: vi.fn(),
}));

vi.mock("../src/lib/native/platform", () => ({
  getNativePlatform: () => "android",
  isNativePlatform: () => true,
}));

import { selectNewestConfiguredNativePurchase } from "../src/lib/native/subscriptionSync";

describe("native subscription entitlement sync", () => {
  it("selects the newest configured Play purchase for server verification", () => {
    const purchase = selectNewestConfiguredNativePurchase([
      {
        productIdentifier: "biblenova",
        purchaseToken: "older-active-purchase-token",
        purchaseDate: "2026-07-01T10:00:00Z",
      },
      {
        productIdentifier: "biblenovayearly",
        purchaseToken: "newer-active-purchase-token",
        purchaseDate: "2026-07-28T10:00:00Z",
      },
    ]);

    expect(purchase?.productIdentifier).toBe("biblenovayearly");
  });

  it("does not send incomplete or unknown purchases to the verifier", () => {
    const purchase = selectNewestConfiguredNativePurchase([
      { productIdentifier: "unknown-plan", purchaseToken: "token" },
      { productIdentifier: "biblenova", purchaseDate: "2026-07-28T10:00:00Z" },
    ]);

    expect(purchase).toBeUndefined();
  });
});
