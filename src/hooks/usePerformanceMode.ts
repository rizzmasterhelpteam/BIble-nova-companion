import { useReducedMotion } from "motion/react";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";

declare global {
  interface Window {
    __BIBLE_NOVA_PERFORMANCE_MODE__?: boolean;
  }
}

export const isNativeAndroidDevice = () =>
  isNativePlatform() && getNativePlatform() === "android";

export const resolvePerformanceMode = ({
  isAndroid,
  prefersReducedMotion,
  override,
}: {
  isAndroid: boolean;
  prefersReducedMotion: boolean;
  override?: boolean;
}) => override ?? (isAndroid || prefersReducedMotion);

export const usePerformanceMode = () => {
  const prefersReducedMotion = Boolean(useReducedMotion());
  const override =
    typeof window === "undefined"
      ? undefined
      : window.__BIBLE_NOVA_PERFORMANCE_MODE__;

  return resolvePerformanceMode({
    isAndroid: isNativeAndroidDevice(),
    prefersReducedMotion,
    override,
  });
};
