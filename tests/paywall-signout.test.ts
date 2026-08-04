import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const paywallSource = readFileSync(
  new URL("../src/pages/Paywall.tsx", import.meta.url),
  "utf8",
);

describe("Paywall account escape hatch", () => {
  it("offers sign out and returns the user to login", () => {
    expect(paywallSource).toContain("logout");
    expect(paywallSource).toContain("await logout()");
    expect(paywallSource).toContain('navigate("/login", { replace: true })');
    expect(paywallSource).toContain("Signed into the wrong account?");
  });

  it("explains the premium and Voice allowance clearly", () => {
    expect(paywallSource).toContain("What is included");
    expect(paywallSource).toContain("Unlimited text reflections");
    expect(paywallSource).toContain("5 hours");
    expect(paywallSource).toContain("per billing cycle");
    expect(paywallSource).toContain("30 minutes");
    expect(paywallSource).toContain("No daily Voice cap");
  });
});
