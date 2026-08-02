import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNativeRuntimeCompatible } from "../src/lib/native/runtime";

describe("native runtime compatibility", () => {
  it("requires an APK bridge that meets the hosted UI minimum", () => {
    expect(isNativeRuntimeCompatible({
      platform: "android",
      appVersion: "1.1.8",
      buildNumber: "11",
      bridgeVersion: 1,
    }, 2)).toBe(false);
  });

  it("uses APK-provided metadata instead of Vite environment values", () => {
    const runtime = readFileSync(new URL("../src/lib/native/runtime.ts", import.meta.url), "utf8");
    const plugin = readFileSync(
      new URL("../android/app/src/main/java/com/biblenovacompanion/app/NativeRuntimePlugin.java", import.meta.url),
      "utf8",
    );
    expect(runtime).toContain("App.getInfo()");
    expect(runtime).not.toContain("import.meta.env.VITE_APP_VERSION");
    expect(plugin).toContain("BuildConfig.NATIVE_BRIDGE_VERSION");
  });
});
