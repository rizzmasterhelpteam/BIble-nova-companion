import { describe, expect, it } from "vitest";
import {
  preserveEntitlementOnServerFailure,
  repairInactiveEntitlement,
} from "../src/lib/entitlementRepair";
import type { EntitlementSnapshot } from "../src/types/entitlement";

const inactiveSnapshot: EntitlementSnapshot = {
  state: "inactive",
  active: false,
  status: "none",
  source: "none",
  productId: null,
  expiresAt: null,
  verifiedAt: "2026-08-02T00:00:00.000Z",
  error: null,
};

describe("Google Play entitlement repair", () => {
  it("preserves an authoritative inactive response when Play repair throws", async () => {
    await expect(repairInactiveEntitlement({
      serverSnapshot: inactiveSnapshot,
      canRepair: true,
      restoreGooglePlayPurchase: async () => {
        throw new Error("Play Billing is unavailable");
      },
      refetchStatus: async () => ({ ...inactiveSnapshot, active: true, state: "active" }),
    })).resolves.toEqual({
      snapshot: inactiveSnapshot,
      restorationError: "Play Billing is unavailable",
    });
  });

  it("refetches the authoritative server status after a successful Play repair", async () => {
    const activeSnapshot: EntitlementSnapshot = {
      ...inactiveSnapshot,
      state: "active",
      active: true,
      status: "active",
      source: "google_play",
      expiresAt: "2026-09-02T00:00:00.000Z",
    };
    await expect(repairInactiveEntitlement({
      serverSnapshot: inactiveSnapshot,
      canRepair: true,
      restoreGooglePlayPurchase: async () => true,
      refetchStatus: async () => activeSnapshot,
    })).resolves.toEqual({ snapshot: activeSnapshot, restorationError: null });
  });

  it("preserves a previous active experience as unknown when the server is unavailable", () => {
    const previousActive = { ...inactiveSnapshot, state: "active" as const, active: true, status: "active" as const };
    expect(preserveEntitlementOnServerFailure(previousActive, new Error("Status unavailable"))).toMatchObject({
      state: "unknown",
      active: true,
      error: "Status unavailable",
    });
  });
});
