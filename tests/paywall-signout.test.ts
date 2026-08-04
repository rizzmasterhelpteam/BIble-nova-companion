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
    expect(paywallSource).not.toContain("Signed into the wrong account?");
    expect(paywallSource).toContain('"Sign out"');
  });

  it("explains the premium and Voice allowance clearly", () => {
    expect(paywallSource).toContain("Premium includes");
    expect(paywallSource).toContain("Unlimited text conversations");
    expect(paywallSource).toContain("More room for what matters");
    expect(paywallSource).toContain("Talk it out. Feel heard. Move forward.");
    expect(paywallSource).toContain("Premium Voice Mode");
    expect(paywallSource).toContain("5 hours");
    expect(paywallSource).toContain("included each billing cycle");
    expect(paywallSource).toContain("30 minutes");
    expect(paywallSource).toContain("No daily limit");
    expect(paywallSource).toContain("Start Premium");
  });
});
