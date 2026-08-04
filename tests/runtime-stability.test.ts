import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("..", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

describe("remote runtime stability contracts", () => {
  it("hydrates Preferences before Auth starts session routing", () => {
    const appStorage = read("src/context/AppStorageContext.tsx");
    const auth = read("src/context/AuthContext.tsx");
    expect(appStorage).toContain("restoreWebStorageFromPreferences");
    expect(auth).toContain('if (storageHydrationStatus === "loading") return;');
    expect(auth).toContain("bible-nova-storage-restored");
  });

  it("keeps native navigation recoverable after keyboard or route changes", () => {
    const viewport = read("src/context/MobileViewportContext.tsx");
    const layout = read("src/components/Layout.tsx");
    expect(viewport).toContain("bible-nova-keyboard-reset");
    expect(viewport).toContain("10_000");
    expect(layout).toContain("resetKeyboardState");
    expect(layout).toContain('mode={isAndroidApp ? "sync" : "wait"}');
    expect(layout).toContain("onNavigate={prepareNavigation}");
  });

  it("does not use Voice eligibility as the membership authority", () => {
    const profile = read("src/components/ProfileCapacityCard.tsx");
    const voice = read("src/components/voice/VoiceMode.tsx");
    expect(profile).toContain("useEntitlement");
    expect(profile).not.toContain("isSubscribed || usageState?.eligible");
    expect(profile).toContain("canRequestVoiceUsage");
    expect(profile).toContain("snapshot.active && snapshot.state !== \"unknown\"");
    expect(profile).toContain('apiFetch("/api/voice/session"');
    expect(profile).not.toContain("DEFAULT_LIMITS");
    expect(voice).toContain("useEntitlement");
  });

  it("describes Voice renewal by billing cycle instead of exposing a calendar reset date", () => {
    const profile = read("src/components/ProfileCapacityCard.tsx");
    expect(profile).toContain("Renews with your next Premium billing cycle.");
    expect(profile).not.toContain("Usage resets ${voiceResetLabel}.");
  });

  it("keeps the capacity dashboard labels visible", () => {
    const layout = read("src/components/Layout.tsx");
    const profile = read("src/components/ProfileCapacityCard.tsx");
    expect(layout).toContain("<ProfileCapacityCard");
    expect(profile).toContain("Capacity usage");
    expect(profile).toContain("Text replies");
    expect(profile).toContain("Unlimited");
    expect(profile).toContain("Voice allowance");
    expect(profile).toContain("min left of");
  });

  it("labels the Voice limit as time per session", () => {
    const profile = read("src/components/ProfileCapacityCard.tsx");
    expect(profile).toContain("Max time per session:");
    expect(profile).not.toContain("Max session:");
  });
});
