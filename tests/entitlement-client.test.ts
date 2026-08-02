import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());

vi.mock("../src/lib/apiClient", () => ({ apiFetch }));

import {
  clearEntitlementCache,
  fetchEntitlementStatus,
  getProvisionalEntitlement,
} from "../src/lib/entitlementClient";

const response = (body: unknown, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
}) as Response;

describe("authoritative entitlement client", () => {
  beforeEach(() => {
    clearEntitlementCache();
    apiFetch.mockReset();
    vi.stubGlobal("window", {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
    });
  });

  it("maps an active Google Play response to the shared snapshot", async () => {
    apiFetch.mockResolvedValue(response({
      state: "active",
      active: true,
      status: "active",
      source: "google_play",
      productId: "biblenova",
      expiresAt: "2026-09-01T00:00:00.000Z",
      verifiedAt: "2026-08-01T00:00:00.000Z",
    }));

    await expect(fetchEntitlementStatus("user-1")).resolves.toMatchObject({
      state: "active",
      active: true,
      source: "google_play",
      productId: "biblenova",
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });

  it("does not convert a temporary verification failure into inactive", async () => {
    apiFetch.mockResolvedValue(response({ error: "Premium verification is temporarily unavailable." }, 503));

    await expect(fetchEntitlementStatus("user-1")).rejects.toThrow("temporarily unavailable");
  });

  it("accepts only valid, non-expired signed metadata as provisional access", () => {
    expect(getProvisionalEntitlement({
      app_metadata: {
        subscription: {
          status: "active",
          source: "native_google_play",
          trialEndsAt: "2099-01-01T00:00:00.000Z",
        },
      },
    })).toMatchObject({ active: true, source: "google_play" });

    expect(getProvisionalEntitlement({
      app_metadata: {
        subscription: {
          status: "expired",
          accessActive: true,
          trialEndsAt: "2099-01-01T00:00:00.000Z",
        },
      },
    })).toBeNull();
  });
});
