import { motion, useReducedMotion } from "motion/react";
import { AppLogo } from "./AppLogo";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";

export function SplashScreen() {
  const prefersReducedMotion = useReducedMotion();
  const isAndroidApp = isNativePlatform() && getNativePlatform() === "android";
  const reduceMotion = prefersReducedMotion || isAndroidApp;

  return (
    <motion.div
      className="app-screen sanctuary-screen fixed inset-0 z-[100] flex w-full flex-col items-center justify-center overflow-hidden"
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0.08 : 0.22, ease: "easeOut" }}
    >
      <div className="sanctuary-atmosphere" />

      <div className="relative z-10 flex flex-col items-center">
        <motion.div
          className="relative mb-6 flex h-28 w-28 items-center justify-center"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.96, y: 4 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.42, ease: [0.22, 1, 0.36, 1] }}
        >
          <div
            className="absolute inset-0 rounded-[2.2rem]"
            style={{
              background: "color-mix(in srgb, var(--app-accent) 13%, transparent)",
              boxShadow: "0 0 46px color-mix(in srgb, var(--app-accent) 24%, transparent)",
            }}
          />
          <div className="sanctuary-brand-mark relative h-20 w-20">
            <AppLogo alt="Bible Nova Companion" loading="eager" fetchPriority="high" className="h-full w-full object-cover" />
          </div>
        </motion.div>

        <h1 className="app-heading px-4 text-center font-serif text-[1.9rem] font-medium tracking-[0.02em] sm:text-[2.05rem]">
          Bible Nova Companion
        </h1>
        <p
          className="mt-2 text-[10px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: "var(--app-accent)" }}
        >
          A quiet place to reflect
        </p>
      </div>
    </motion.div>
  );
}
