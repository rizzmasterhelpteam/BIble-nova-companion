import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const paywallSource = readFileSync(new URL("../src/pages/Paywall.tsx", import.meta.url), "utf8");

describe("payment enforcement", () => {
  it("requires a resolved premium entitlement on every platform", () => {
    expect(appSource).not.toContain("bypassPaymentOnWeb");
    expect(appSource).toContain("hasCompletedOnboarding,");
    expect(appSource).toContain("location.pathname === \"/paywall\" && isSubscribed");
    expect(paywallSource).toContain("if (!isSubscribed) return;");
  });
});
