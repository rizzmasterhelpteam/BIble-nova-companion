import { motion, useReducedMotion } from "motion/react";
import { AppLogo } from "./AppLogo";

type SplashScreenProps = {
  animated?: boolean;
};

export function SplashScreen({ animated = true }: SplashScreenProps) {
  const prefersReducedMotion = useReducedMotion();
  const shouldAnimate = animated && !prefersReducedMotion;

  return (
    <motion.div
      className="app-screen sanctuary-screen fixed inset-0 z-[100] flex w-full flex-col items-center justify-center overflow-hidden"
      initial={shouldAnimate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      transition={{ duration: shouldAnimate ? 0.36 : 0, ease: "easeOut" }}
      style={{ willChange: shouldAnimate ? "opacity" : undefined }}
    >
      <div className="sanctuary-atmosphere" />

      <div className="relative z-10 flex flex-col items-center">
        <div className="relative mb-6 flex h-28 w-28 items-center justify-center">
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
        </div>

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
