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
});
