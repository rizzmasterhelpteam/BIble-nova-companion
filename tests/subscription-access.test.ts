import { describe, expect, it } from "vitest";

import {
  shouldRedirectAndroidToPaywall,
  shouldWaitForAndroidSubscriptionResolution,
} from "../src/lib/subscriptionAccess";

describe("Android subscription access gating", () => {
  it("holds the app behind a loader while cached Android premium is being verified", () => {
    expect(
      shouldWaitForAndroidSubscriptionResolution({
        isAndroidNative: true,
        hasCompletedOnboarding: true,
        isSubscriptionResolved: false,
      }),
    ).toBe(true);
  });

  it("does not hold onboarding or web users on the subscription verifier", () => {
    expect(
      shouldWaitForAndroidSubscriptionResolution({
        isAndroidNative: true,
        hasCompletedOnboarding: false,
        isSubscriptionResolved: false,
      }),
    ).toBe(false);

    expect(
      shouldWaitForAndroidSubscriptionResolution({
        isAndroidNative: false,
        hasCompletedOnboarding: true,
        isSubscriptionResolved: false,
      }),
    ).toBe(false);
  });

  it("redirects resolved non-premium Android users to the paywall", () => {
    expect(
      shouldRedirectAndroidToPaywall({
        isAndroidNative: true,
        hasCompletedOnboarding: true,
        isSubscribed: false,
        pathname: "/",
      }),
    ).toBe(true);
  });

  it("keeps premium Android users and paywall visitors on their current route", () => {
    expect(
      shouldRedirectAndroidToPaywall({
        isAndroidNative: true,
        hasCompletedOnboarding: true,
        isSubscribed: true,
        pathname: "/",
      }),
    ).toBe(false);

    expect(
      shouldRedirectAndroidToPaywall({
        isAndroidNative: true,
        hasCompletedOnboarding: true,
        isSubscribed: false,
        pathname: "/paywall",
      }),
    ).toBe(false);
  });
});
