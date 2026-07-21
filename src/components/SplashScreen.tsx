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
      ? { initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.52, ease: [0.22, 1, 0.36, 1], delay } }
      : {};

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex w-full flex-col items-center justify-center overflow-hidden"
      style={{ background: "#0F0F12" }}
      initial={shouldAnimate ? { opacity: 0 } : false}
      animate={{ opacity: 1 }}
      exit={shouldAnimate ? { opacity: 0 } : undefined}
      transition={{ duration: shouldAnimate ? 0.24 : 0, ease: "easeOut" }}
    >
      {/* Ambient glow orbs */}
      {shouldAnimate && (
        <>
          <div
            className="pointer-events-none absolute -top-[10%] -left-[10%] h-[500px] w-[500px] rounded-full"
            style={{ background: "rgba(245,158,11,0.07)", filter: "blur(100px)" }}
          />
          <div
            className="pointer-events-none absolute top-[50%] -right-[10%] h-[500px] w-[500px] rounded-full"
            style={{ background: "rgba(239,68,68,0.05)", filter: "blur(100px)" }}
          />
        </>
      )}

      <div className="relative z-10 flex flex-col items-center">
        {/* Logo icon with scale entrance + glow ring + breathing float */}
        <motion.div
          className="relative mb-6 flex h-28 w-28 items-center justify-center"
          initial={shouldAnimate ? { opacity: 0, scale: 0.72 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={shouldAnimate ? { duration: 0.64, ease: [0.22, 1, 0.36, 1], delay: 0.05 } : { duration: 0 }}
        >
          {/* One-shot border ring; an infinite loop here keeps the opening screen busy. */}
          {shouldAnimate && (
            <motion.div
              className="absolute inset-[-8px] rounded-full"
              animate={{ rotate: 180 }}
              transition={{ duration: 0.7, ease: "easeOut", delay: 0.05 }}
              style={{
                border: "1.5px solid transparent",
                borderTopColor: "rgba(245,158,11,0.6)",
                borderRightColor: "rgba(245,158,11,0.15)",
                borderRadius: "50%",
              }}
            />
          )}
          {/* Outer glow ring */}
          {shouldAnimate && (
            <motion.div
              className="absolute inset-[-6px] rounded-full"
              initial={{ opacity: 0, scale: 0.88 }}
              animate={{ opacity: [0, 0.5, 0.25], scale: [0.88, 1.04, 1] }}
              transition={{ duration: 1.2, ease: "easeOut", delay: 0.38 }}
              style={{
                boxShadow: "0 0 0 1.5px rgba(245,158,11,0.28), 0 0 48px rgba(245,158,11,0.22)",
                borderRadius: "50%",
                pointerEvents: "none",
              }}
            />
          )}
          {/* Icon background */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: "rgba(245,158,11,0.1)",
              boxShadow: "0 0 50px rgba(245,158,11,0.18)",
            }}
          />
          {/* Logo entrance */}
          <motion.div
            className="relative h-20 w-20 overflow-hidden rounded-full"
            initial={shouldAnimate ? { y: 4 } : false}
            animate={shouldAnimate ? { y: 0 } : undefined}
            transition={shouldAnimate ? { duration: 0.42, ease: "easeOut", delay: 0.18 } : undefined}
          >
            <AppLogo alt="Bible Nova Companion" loading="eager" fetchPriority="high" className="h-full w-full object-cover" />
          </motion.div>
        </motion.div>

        {/* Title — slides up after logo */}
        <motion.h1
          className="px-4 text-center font-serif text-[1.9rem] font-medium tracking-[0.02em] sm:text-[2.05rem]"
          style={{ color: "rgba(255,255,255,0.95)" }}
          {...stagger(0.34)}
        >
          Bible Nova Companion
        </motion.h1>

        {/* Tagline — fades in last */}
        <motion.p
          className="mt-2 text-[10px] font-semibold uppercase tracking-[0.28em]"
          style={{ color: "rgba(245,158,11,0.85)" }}
          {...stagger(0.54)}
        >
          A quiet place to reflect
        </motion.p>

        {/* Static loading indicator keeps the splash compositor-friendly. */}
        {shouldAnimate && (
          <motion.div
            className="mt-8 flex items-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.2 }}
          >
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "rgba(245,158,11,0.65)" }}
              />
            ))}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
