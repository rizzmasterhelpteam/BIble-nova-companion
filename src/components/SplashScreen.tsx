import { motion, useReducedMotion } from "motion/react";
import { AppLogo } from "./AppLogo";

type SplashScreenProps = {
  animated?: boolean;
};

export function SplashScreen({ animated = true }: SplashScreenProps) {
  const prefersReducedMotion = useReducedMotion();
  const shouldAnimate = animated && !prefersReducedMotion;

  const stagger = (delay: number) =>
    shouldAnimate
      ? { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.48, ease: [0.22, 1, 0.36, 1], delay } }
      : {};

  return (
    <motion.div
      className="app-screen sanctuary-screen fixed inset-0 z-[100] flex w-full flex-col items-center justify-center overflow-hidden"
      initial={shouldAnimate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={shouldAnimate ? { opacity: 0, scale: 0.98 } : undefined}
      transition={{ duration: shouldAnimate ? 0.38 : 0, ease: "easeOut" }}
      style={{ willChange: shouldAnimate ? "opacity" : undefined }}
    >
      <div className="sanctuary-atmosphere" />

      <div className="relative z-10 flex flex-col items-center">
        {/* Logo icon with scale entrance + glow ring + breathing float */}
        <motion.div
          className="relative mb-6 flex h-28 w-28 items-center justify-center"
          initial={shouldAnimate ? { opacity: 0, scale: 0.78 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={shouldAnimate ? { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay: 0.05 } : { duration: 0 }}
        >
          {/* Outer glow ring */}
          {shouldAnimate && (
            <motion.div
              className="absolute inset-[-6px] rounded-[2.6rem]"
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: [0, 0.55, 0.28], scale: [0.88, 1.04, 1] }}
              transition={{ duration: 1.1, ease: "easeOut", delay: 0.35 }}
              style={{
                background: "transparent",
                boxShadow: "0 0 0 1.5px color-mix(in srgb, var(--app-accent) 36%, transparent), 0 0 40px color-mix(in srgb, var(--app-accent) 28%, transparent)",
                borderRadius: "2.6rem",
                pointerEvents: "none",
              }}
            />
          )}
          {/* Icon background */}
          <div
            className="absolute inset-0 rounded-[2.2rem]"
            style={{
              background: "color-mix(in srgb, var(--app-accent) 13%, transparent)",
              boxShadow: "0 0 46px color-mix(in srgb, var(--app-accent) 22%, transparent)",
            }}
          />
          {/* Floating logo */}
          <motion.div
            className="sanctuary-brand-mark relative h-20 w-20"
            animate={shouldAnimate ? { y: [0, -5, 0] } : {}}
            transition={shouldAnimate ? { duration: 3.2, ease: "easeInOut", repeat: Infinity, delay: 0.7 } : {}}
          >
            <AppLogo alt="Bible Nova Companion" loading="eager" fetchPriority="high" className="h-full w-full object-cover" />
          </motion.div>
        </motion.div>

        {/* Title — slides up after logo */}
        <motion.h1
          className="app-heading px-4 text-center font-serif text-[1.9rem] font-medium tracking-[0.02em] sm:text-[2.05rem]"
          {...stagger(0.32)}
        >
          Bible Nova Companion
        </motion.h1>

        {/* Tagline — fades in last */}
        <motion.p
          className="mt-2 text-[10px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: "var(--app-accent)" }}
          {...stagger(0.52)}
        >
          A quiet place to reflect
        </motion.p>

        {/* Loading pulse dots */}
        {shouldAnimate && (
          <motion.div
            className="mt-8 flex items-center gap-1.5"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.72, duration: 0.3 }}
          >
            {[0, 1, 2].map((i) => (
              <motion.span
                key={i}
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "color-mix(in srgb, var(--app-accent) 58%, transparent)" }}
                animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
                transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.18, ease: "easeInOut" }}
              />
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
