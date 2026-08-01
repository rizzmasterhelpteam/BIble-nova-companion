import { beforeEach, describe, expect, it, vi } from "vitest";

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

import { apiFetch } from "../src/lib/apiClient";
import { restorePurchases } from "../src/lib/native/purchases";
import {
  refreshNativeSubscriptionEntitlement,
  selectNewestConfiguredNativePurchase,
} from "../src/lib/native/subscriptionSync";

describe("native subscription entitlement sync", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("window", globalThis);
  });

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

  it("refreshes an active Play entitlement on app startup", async () => {
    vi.mocked(restorePurchases).mockResolvedValue([
      {
        productIdentifier: "biblenova",
        purchaseToken: "renewed-purchase-token",
        purchaseDate: "2026-07-29T16:44:00Z",
      },
    ] as never);
    vi.mocked(apiFetch).mockResolvedValue(
      new Response(JSON.stringify({ subscription: { accessActive: true } }), { status: 200 }),
    );

    await expect(refreshNativeSubscriptionEntitlement()).resolves.toBe(true);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/subscription/native-sync",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          productId: "biblenova",
          planId: "monthly",
          orderId: undefined,
          purchaseToken: "renewed-purchase-token",
          platform: "android",
        }),
      }),
    );
  });

  it("does not unlock premium when Play has no active purchase", async () => {
    vi.mocked(restorePurchases).mockRejectedValue(
      new Error("No active subscriptions were found to restore."),
    );

    await expect(refreshNativeSubscriptionEntitlement()).rejects.toThrow(
      "No active subscriptions were found to restore.",
    );
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("does not report premium repair for an authoritative non-active state", async () => {
    vi.mocked(restorePurchases).mockResolvedValue([{
      productIdentifier: "biblenova",
      purchaseToken: "held-purchase-token",
    }] as never);
    vi.mocked(apiFetch).mockResolvedValue(new Response(JSON.stringify({
      subscription: { accessActive: false },
    }), { status: 200 }));

    await expect(refreshNativeSubscriptionEntitlement()).resolves.toBe(false);
  });
});
