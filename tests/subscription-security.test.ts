import { afterEach, describe, expect, it } from "vitest";
import {
  mapGooglePlaySubscriptionState,
  selectAllowedGooglePlayLineItem,
  stateUnlocksPremium,
} from "../server-subscription-security";

describe("server-owned Google Play subscription security", () => {
  afterEach(() => {
    delete process.env.GOOGLE_PLAY_MONTHLY_ALLOWED_OFFER_IDS;
  });

  it("accepts the configured monthly trial and derives values from Google", () => {
    const item = selectAllowedGooglePlayLineItem([{
      productId: "biblenova",
      expiryTime: "2026-09-01T00:00:00Z",
      latestSuccessfulOrderId: "GPA.verified",
      offerDetails: { basePlanId: "monthly", offerId: "trial" },
    }]);
    expect(item.latestSuccessfulOrderId).toBe("GPA.verified");
  });

  it("accepts the configured yearly base plan", () => {
    expect(selectAllowedGooglePlayLineItem([{
      productId: "biblenovayearly",
      offerDetails: { basePlanId: "yearlyoffer" },
    }]).productId).toBe("biblenovayearly");
  });

  it.each([
    { productId: "other", offerDetails: { basePlanId: "monthly" } },
    { productId: "biblenova", offerDetails: { basePlanId: "wrong" } },
    { productId: "biblenova", offerDetails: { basePlanId: "monthly", offerId: "unknown" } },
  ])("rejects a product, plan, or offer outside the server allowlist", (item) => {
    expect(() => selectAllowedGooglePlayLineItem([item])).toThrow("not an allowed");
  });

  it("rejects ambiguous matching line items", () => {
    const item = { productId: "biblenova", offerDetails: { basePlanId: "monthly", offerId: "trial" } };
    expect(() => selectAllowedGooglePlayLineItem([item, item])).toThrow("ambiguous");
  });

  it("preserves authoritative states and unlocks only active or grace", () => {
    expect(mapGooglePlaySubscriptionState("SUBSCRIPTION_STATE_IN_GRACE_PERIOD")).toBe("grace_period");
    expect(mapGooglePlaySubscriptionState("SUBSCRIPTION_STATE_ON_HOLD")).toBe("on_hold");
    expect(stateUnlocksPremium("active")).toBe(true);
    expect(stateUnlocksPremium("grace_period")).toBe(true);
    expect(stateUnlocksPremium("on_hold")).toBe(false);
    expect(stateUnlocksPremium("revoked")).toBe(false);
  });
});
