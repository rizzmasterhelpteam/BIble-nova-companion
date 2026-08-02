import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/native/platform", () => ({ isNativePlatform: () => false }));

import {
  clearOnboardingDraft,
  getOnboardingDraftKey,
  LEGACY_ONBOARDING_DRAFT_KEY,
  LEGACY_ONBOARDING_DRAFT_OWNER_KEY,
  loadOnboardingDraft,
  saveOnboardingDraft,
} from "../src/lib/onboardingDraft";

describe("account-scoped onboarding drafts", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  };
  beforeAll(() => {
    vi.stubGlobal("localStorage", storage);
    vi.stubGlobal("window", { localStorage: storage });
  });
  beforeEach(() => localStorage.clear());

  it("never exposes another account's draft", () => {
    saveOnboardingDraft("user-a", { reason: "stress" });
    expect(loadOnboardingDraft("user-b")).toEqual({});
  });

  it("discards an ambiguous legacy draft instead of assigning it to an account", () => {
    localStorage.setItem(LEGACY_ONBOARDING_DRAFT_KEY, JSON.stringify({ reason: "faith" }));
    expect(loadOnboardingDraft("user-a")).toEqual({});
    expect(localStorage.getItem(LEGACY_ONBOARDING_DRAFT_KEY)).toBeNull();
    expect(loadOnboardingDraft("user-b")).toEqual({});
  });

  it("migrates a legacy draft once only when its owner is trustworthy", () => {
    localStorage.setItem(LEGACY_ONBOARDING_DRAFT_KEY, JSON.stringify({ reason: "faith" }));
    localStorage.setItem(LEGACY_ONBOARDING_DRAFT_OWNER_KEY, "user-a");
    expect(loadOnboardingDraft("user-a")).toEqual({ reason: "faith" });
    expect(localStorage.getItem(LEGACY_ONBOARDING_DRAFT_KEY)).toBeNull();
    expect(loadOnboardingDraft("user-b")).toEqual({});
  });

  it("clears only the current user's draft", () => {
    saveOnboardingDraft("user-a", { goal: "peace" });
    saveOnboardingDraft("user-b", { goal: "strength" });
    clearOnboardingDraft("user-a");
    expect(localStorage.getItem(getOnboardingDraftKey("user-a"))).toBeNull();
    expect(loadOnboardingDraft("user-b")).toEqual({ goal: "strength" });
  });
});
