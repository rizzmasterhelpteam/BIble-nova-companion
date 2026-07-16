import { motion, useReducedMotion } from "motion/react";
import { AppLogo } from "./AppLogo";
import { getNativePlatform, isNativePlatform } from "../lib/native/platform";

export function SplashScreen() {
  const prefersReducedMotion = useReducedMotion();
  const isAndroidApp = isNativePlatform() && getNativePlatform() === "android";
  const reduceMotion = prefersReducedMotion || isAndroidApp;

  return (
    <motion.div
      className="app-screen fixed inset-0 z-[100] flex w-full flex-col items-center justify-center overflow-hidden"
      style={{ background: "var(--app-page-bg)" }}
      initial={false}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduceMotion ? 0.08 : 0.18, ease: "linear" }}
    >
      <div className="app-atmosphere absolute inset-0 z-0">
        <div className="app-grid" />
        <div className="app-orb app-orb-a left-[-12%] top-[-16%] h-[22rem] w-[22rem]" />
        <div className="app-orb app-orb-b bottom-[-18%] right-[-12%] h-[24rem] w-[24rem]" />
      </div>

      <div className="relative z-10 flex flex-col items-center">
        <motion.div
          className="relative mb-7 flex h-28 w-28 items-center justify-center"
          initial={reduceMotion ? false : { opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: reduceMotion ? 0 : 0.24, ease: "easeOut" }}
        >
          <div
            className="absolute inset-1 rounded-[2rem]"
            style={{
              background: "color-mix(in srgb, var(--app-accent) 20%, transparent)",
              boxShadow: "0 0 34px color-mix(in srgb, var(--app-accent) 22%, transparent)",
            }}
          />
          <div className="relative flex h-20 w-20 items-center justify-center overflow-hidden rounded-[1.5rem] border border-white/30 bg-white shadow-xl">
            <AppLogo alt="Bible Nova Companion" className="h-full w-full object-cover" />
          </div>
        </motion.div>

        <h1 className="app-heading font-serif text-[2.15rem] font-normal tracking-wide">
          Bible Nova
        </h1>
        <p
          className="mt-2 text-[10px] font-semibold uppercase tracking-[0.34em]"
          style={{ color: "var(--app-accent)" }}
        >
          Companion
        </p>
      </div>
    </motion.div>
  );
}
