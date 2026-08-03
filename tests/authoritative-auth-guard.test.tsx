import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  value: { user: { id: "new-user" }, isLoading: false, hasCompletedOnboarding: false },
}));
const entitlementState = vi.hoisted(() => ({
  value: {
    snapshot: { state: "inactive", active: false, error: null },
    isRefreshing: false,
    refresh: vi.fn(),
  },
}));

vi.mock("../src/context/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => authState.value,
}));
vi.mock("../src/context/EntitlementContext", () => ({
  EntitlementProvider: ({ children }: { children: React.ReactNode }) => children,
  useEntitlement: () => entitlementState.value,
}));
vi.mock("../src/lib/supabase", () => ({
  isSupabaseConfigured: false,
  supabase: { auth: {} },
}));

import { AuthoritativeAuthGuard, NativeRuntimeGate } from "../src/App";

describe("AuthoritativeAuthGuard", () => {
  beforeEach(() => {
    authState.value = { user: { id: "new-user" }, isLoading: false, hasCompletedOnboarding: false };
    entitlementState.value = {
      snapshot: { state: "inactive", active: false, error: null },
      isRefreshing: false,
      refresh: vi.fn(),
    };
  });

  it("keeps an incomplete onboarding user on Onboarding when entitlement is inactive", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/onboarding"]}>
        <AuthoritativeAuthGuard>
          <div data-screen="onboarding">Onboarding screen</div>
        </AuthoritativeAuthGuard>
      </MemoryRouter>,
    );

    expect(markup).toContain("Onboarding screen");
    expect(markup).not.toContain("Membership check");
  });

  it("keeps a completed inactive user on Paywall instead of redirecting in a loop", () => {
    authState.value = { user: { id: "new-user" }, isLoading: false, hasCompletedOnboarding: true };
    const markup = renderToStaticMarkup(
      <MemoryRouter initialEntries={["/paywall"]}>
        <AuthoritativeAuthGuard>
          <div data-screen="paywall">Paywall screen</div>
        </AuthoritativeAuthGuard>
      </MemoryRouter>,
    );

    expect(markup).toContain("Paywall screen");
  });

  it("shows Update Required when the installed bridge is older than the hosted UI minimum", () => {
    const markup = renderToStaticMarkup(
      <NativeRuntimeGate
        status="ready"
        minimumBridgeVersion={2}
        runtime={{ platform: "android", appVersion: "1.1.8", buildNumber: "11", bridgeVersion: 1 }}
      >
        <div>Plugin-dependent app</div>
      </NativeRuntimeGate>,
    );

    expect(markup).toContain("Update required");
    expect(markup).not.toContain("Plugin-dependent app");
  });
});
