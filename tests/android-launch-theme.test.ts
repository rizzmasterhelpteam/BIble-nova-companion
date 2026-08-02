import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const capacitorConfig = read("capacitor.config.ts");
const styles = read("android/app/src/main/res/values/styles.xml");
const lightColors = read("android/app/src/main/res/values/colors.xml");
const darkColors = read("android/app/src/main/res/values-night/colors.xml");
const splash = read("android/app/src/main/res/drawable/splash_black.xml");
const splashIcon = read("android/app/src/main/res/drawable/splash_black_icon.xml");

describe("Android launch surface", () => {
  it("does not reintroduce a black launch frame", () => {
    const launchSources = [capacitorConfig, styles, lightColors, darkColors, splash, splashIcon];

    for (const source of launchSources) {
      expect(source).not.toMatch(/#000000/i);
    }

    expect(styles).not.toContain('android:background">@null');
    expect(capacitorConfig).not.toContain("launchFadeOutDuration: 0");
  });

  it("uses matching light and dark launch resources", () => {
    expect(lightColors).toContain('name="app_launch_background">#D9E9F7');
    expect(darkColors).toContain('name="app_launch_background">#050B14');
    expect(styles).toContain("@color/app_launch_background");
    expect(capacitorConfig).toContain("launchFadeOutDuration: 200");
    expect(capacitorConfig).toContain('backgroundColor: "#050B14"');
  });
});
