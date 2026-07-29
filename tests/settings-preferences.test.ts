import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const layoutSource = readFileSync(
  new URL("../src/components/Layout.tsx", import.meta.url),
  "utf8",
);
const authSource = readFileSync(
  new URL("../src/context/AuthContext.tsx", import.meta.url),
  "utf8",
);
const voiceModeSource = readFileSync(
  new URL("../src/components/voice/VoiceMode.tsx", import.meta.url),
  "utf8",
);
const serverApiSource = readFileSync(
  new URL("../server-api.ts", import.meta.url),
  "utf8",
);

describe("Settings preferences", () => {
  it("removes the duplicate account switch action", () => {
    expect(layoutSource).not.toContain("Switch Account");
    expect(layoutSource).not.toContain("handleSwitchAccount");
    expect(layoutSource).toContain("Sign Out");
  });

  it("shows transparent opt-in memory controls", () => {
    expect(layoutSource).toContain("Remember my preferences");
    expect(layoutSource).toContain("Turning it off stops memory and clears remembered context.");
    expect(layoutSource).toContain('role="switch"');
    expect(authSource).toContain('method: "PUT"');
    expect(authSource).toContain("if (!memoryEnabled)");
    expect(voiceModeSource).toContain("if (!memoryEnabled) return");
    expect(serverApiSource).toContain("rememberUser: memoryProfile.memoryEnabled");
    expect(serverApiSource).toContain(
      "memoryProfile.memoryEnabled ? memoryProfile.shadowNotes : null",
    );
  });
});
