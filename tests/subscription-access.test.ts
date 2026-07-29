import { describe, expect, it } from "vitest";

import {
  shouldRedirectToPaywall,
  shouldWaitForSubscriptionResolution,
} from "../src/lib/subscriptionAccess";

describe("subscription access gating", () => {
  it("holds the app behind a loader while premium is being verified", () => {
    expect(
      shouldWaitForSubscriptionResolution({
        hasCompletedOnboarding: true,
        isSubscriptionResolved: false,
      }),
    ).toBe(true);
  });

  it("does not hold onboarding on the subscription verifier", () => {
    expect(
      shouldWaitForSubscriptionResolution({
        hasCompletedOnboarding: false,
        isSubscriptionResolved: false,
      }),
    ).toBe(false);
  });

  it("redirects resolved non-premium users to the paywall", () => {
    expect(
      shouldRedirectToPaywall({
        hasCompletedOnboarding: true,
        isSubscribed: false,
        pathname: "/",
      }),
    ).toBe(true);
  });

  it("keeps premium users and paywall visitors on their current route", () => {
    expect(
      shouldRedirectToPaywall({
        hasCompletedOnboarding: true,
        isSubscribed: true,
        pathname: "/",
      }),
    ).toBe(false);

    expect(
      shouldRedirectToPaywall({
        hasCompletedOnboarding: true,
        isSubscribed: false,
        pathname: "/paywall",
      }),
    ).toBe(false);
  });
});
