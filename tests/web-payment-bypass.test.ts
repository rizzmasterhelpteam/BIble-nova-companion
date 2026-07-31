import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

describe("temporary web payment bypass", () => {
  it("skips client paywall and subscription-loading gates only outside Capacitor", () => {
    expect(appSource).toContain("const bypassPaymentOnWeb = !isNativePlatform();");
    expect(appSource).toContain("!bypassPaymentOnWeb &&");
    expect(appSource).toContain("hasCompletedOnboarding: !bypassPaymentOnWeb && hasCompletedOnboarding");
    expect(appSource).toContain("isSubscribed || bypassPaymentOnWeb");
  });
});
