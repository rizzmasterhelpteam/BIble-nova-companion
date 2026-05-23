import React from "react";
import { motion, useReducedMotion } from "motion/react";

export function SplashScreen() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div
      className="app-screen fixed inset-0 z-[100] flex w-full flex-col items-center justify-center overflow-hidden"
      style={{ background: "var(--app-page-bg)", willChange: "opacity, transform" }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: prefersReducedMotion ? 0.15 : 0.4, ease: "easeOut" }}
    >
      {/* Standard App Background */}
      <div className="app-atmosphere absolute inset-0 z-0">
        <div className="app-grid" />
        <div className="app-orb app-orb-a left-[-8%] top-[-12%] h-[28rem] w-[28rem]" />
        <div className="app-orb app-orb-b bottom-[-16%] right-[-8%] h-[30rem] w-[30rem]" />
      </div>

      {/* Main Container */}
      <div className="relative z-10 flex flex-col items-center justify-center">

        {/* Premium Nova Animation */}
        <div className="relative flex h-36 w-36 items-center justify-center mb-9">

          {/* Outermost ambient glow ring */}
          <motion.div
            className="absolute rounded-full"
            style={{
              width: "9rem",
              height: "9rem",
              background: "radial-gradient(circle, color-mix(in srgb, var(--app-accent) 22%, transparent) 0%, transparent 72%)",
              willChange: "transform, opacity",
              transform: "translateZ(0)",
            }}
            animate={prefersReducedMotion ? undefined : {
              scale: [1, 1.35, 1],
              opacity: [0.6, 1, 0.6],
            }}
            transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Pulsing accent ring */}
          <motion.div
            className="absolute rounded-full border-2"
            style={{
              width: "7.5rem",
              height: "7.5rem",
              borderColor: "color-mix(in srgb, var(--app-accent) 30%, transparent)",
              willChange: "transform, opacity",
            }}
            animate={prefersReducedMotion ? undefined : {
              scale: [1, 1.12, 1],
              opacity: [0.5, 0.9, 0.5],
            }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut", delay: 0.4 }}
          />

          {/* Inner breathing backdrop */}
          <motion.div
            className="absolute inset-0 rounded-full blur-2xl"
            style={{
              background: "var(--app-accent)",
              opacity: 0.22,
              willChange: "transform, opacity",
              transform: "translateZ(0)",
            }}
            animate={prefersReducedMotion ? undefined : {
              scale: [1, 1.5, 1],
              opacity: [0.22, 0.5, 0.22],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Central Elegant Cross */}
          <motion.svg
            viewBox="0 0 100 100"
            className="absolute h-[4.25rem] w-[4.25rem]"
            style={{ color: "var(--app-accent)", willChange: "transform, opacity" }}
            initial="hidden"
            animate="visible"
          >
            {/* Stroke draws itself */}
            <motion.path
              d="M44 10 h12 v22 h22 v12 h-22 v46 h-12 v-46 h-22 v-12 h22 z"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinejoin="round"
              fill="transparent"
              variants={{
                hidden: { pathLength: 0, opacity: 0 },
                visible: {
                  pathLength: 1,
                  opacity: 1,
                  transition: { duration: prefersReducedMotion ? 0 : 0.7, ease: "easeInOut" },
                },
              }}
            />
            {/* Fill glows in */}
            <motion.path
              d="M44 10 h12 v22 h22 v12 h-22 v46 h-12 v-46 h-22 v-12 h22 z"
              fill="currentColor"
              variants={{
                hidden: { opacity: 0, scale: 0.9 },
                visible: {
                  opacity: 0.92,
                  scale: 1,
                  transition: {
                    delay: prefersReducedMotion ? 0 : 0.3,
                    duration: prefersReducedMotion ? 0 : 0.45,
                    ease: [0.22, 1, 0.36, 1],
                  },
                },
              }}
              style={{ originX: "50px", originY: "50px" }}
            />
          </motion.svg>

          {/* Orbiting particle 1 */}
          <motion.div
            className="absolute h-2 w-2 rounded-full"
            style={{
              background: "var(--app-accent)",
              boxShadow: "0 0 10px 2px color-mix(in srgb, var(--app-accent) 60%, transparent)",
              willChange: "transform",
            }}
            animate={prefersReducedMotion ? undefined : {
              rotate: [0, 360],
              x: [0, 30, 0, -30, 0],
              y: [-30, 0, 30, 0, -30],
              scale: [1, 1.3, 1, 1.3, 1],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          />

          {/* Orbiting particle 2 — counter-rotation */}
          <motion.div
            className="absolute h-1.5 w-1.5 rounded-full"
            style={{
              background: "color-mix(in srgb, var(--app-accent) 75%, white)",
              boxShadow: "0 0 8px color-mix(in srgb, var(--app-accent) 50%, transparent)",
              willChange: "transform",
            }}
            animate={prefersReducedMotion ? undefined : {
              rotate: [360, 0],
              x: [0, -24, 0, 24, 0],
              y: [24, 0, -24, 0, 24],
            }}
            transition={{ duration: 4.2, repeat: Infinity, ease: "linear" }}
          />
        </div>

        {/* Brand Typography */}
        <div className="overflow-hidden">
          <motion.h1
            initial={prefersReducedMotion ? false : { y: "100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{
              duration: prefersReducedMotion ? 0 : 0.48,
              delay: prefersReducedMotion ? 0 : 0.32,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="app-heading font-serif text-[2.6rem] font-normal tracking-wide"
          >
            Bible Nova
          </motion.h1>
        </div>

        <div className="mt-2 overflow-hidden">
          <motion.p
            initial={prefersReducedMotion ? false : { y: "110%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{
              duration: prefersReducedMotion ? 0 : 0.36,
              delay: prefersReducedMotion ? 0 : 0.52,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="text-xs font-semibold uppercase tracking-[0.38em]"
            style={{ color: "var(--app-accent)" }}
          >
            Companion
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}
