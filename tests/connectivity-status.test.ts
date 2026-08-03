import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/components/ConnectivityStatus.tsx", import.meta.url),
  "utf8",
);

describe("ConnectivityStatus", () => {
  it("uses the platform network adapter so native Android connectivity changes are visible", () => {
    expect(source).toContain("getPlatformAdapter().network");
    expect(source).toContain("network.subscribe(updateNetworkState)");
    expect(source).toContain("network.getStatus().then(updateNetworkState)");
  });

  it("keeps a clear no-network alert visible until connectivity returns", () => {
    expect(source).toContain("No internet connection.");
    expect(source).toContain("dismissible: false");
  });
});
