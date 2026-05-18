import React from "react";
import { motion, useReducedMotion } from "motion/react";

export function SplashScreen() {
  const prefersReducedMotion = useReducedMotion();

  return (
    <motion.div 
      className="app-screen fixed inset-0 z-[100] flex w-full flex-col items-center justify-center overflow-hidden"
      style={{ background: "var(--app-page-bg)", willChange: "opacity, transform" }}
      exit={{ opacity: 0 }}
      transition={{ duration: prefersReducedMotion ? 0.15 : 0.3, ease: "easeOut" }}
    >
      {/* Standard App Background */}
      <div className="app-atmosphere absolute inset-0 z-0">
        <div className="app-grid" />
        <div className="app-orb app-orb-a left-[-8%] top-[-12%] h-[24rem] w-[24rem]" />
        <div className="app-orb app-orb-b bottom-[-16%] right-[-8%] h-[26rem] w-[26rem]" />
      </div>

      {/* Main Container */}
      <div className="relative z-10 flex flex-col items-center justify-center">
        
        {/* The Premium "Nova" Animation */}
        <div className="relative flex h-32 w-32 items-center justify-center mb-8">
          
          {/* Ethereal breathing backdrop */}
          <motion.div
            className="absolute inset-0 rounded-full bg-[color:var(--app-accent)] opacity-20 blur-2xl"
            style={{ willChange: "transform, opacity", transform: "translateZ(0)" }}
            animate={prefersReducedMotion ? undefined : {
              scale: [1, 1.5, 1],
              opacity: [0.2, 0.5, 0.2],
            }}
            transition={{
              duration: 3,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />

          {/* Central Elegant Cross */}
          <motion.svg
            viewBox="0 0 100 100"
            className="absolute h-16 w-16 text-[color:var(--app-accent)]"
            style={{ willChange: "transform, opacity" }}
            initial="hidden"
            animate="visible"
          >
            {/* The outer path of the cross drawing itself */}
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
                  transition: { duration: prefersReducedMotion ? 0 : 0.6, ease: "easeInOut" }
                }
              }}
            />
            
            {/* The fill of the cross slowly glowing into existence */}
            <motion.path
              d="M44 10 h12 v22 h22 v12 h-22 v46 h-12 v-46 h-22 v-12 h22 z"
              fill="currentColor"
              variants={{
                hidden: { opacity: 0, scale: 0.95 },
                visible: {
                  opacity: 0.9,
                  scale: 1,
                  transition: { delay: prefersReducedMotion ? 0 : 0.25, duration: prefersReducedMotion ? 0 : 0.4, ease: [0.22, 1, 0.36, 1] }
                }
              }}
              style={{ originX: "50px", originY: "50px" }}
            />
          </motion.svg>

          {/* Orbiting particle 1 */}
          <motion.div
            className="absolute h-1.5 w-1.5 rounded-full bg-[color:var(--app-accent)] shadow-[0_0_10px_currentColor]"
            style={{ willChange: "transform" }}
            animate={prefersReducedMotion ? undefined : {
              rotate: [0, 360],
              x: [0, 25, 0, -25, 0],
              y: [-25, 0, 25, 0, -25],
              scale: [1, 1.2, 1, 1.2, 1],
            }}
            transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
          />
        </div>

        {/* Minimal Typography Entrance */}
        <div className="overflow-hidden">
          <motion.h1
            initial={prefersReducedMotion ? false : { y: "100%" }}
            animate={{ y: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.4, delay: prefersReducedMotion ? 0 : 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="app-heading font-serif text-[2.5rem] font-normal tracking-wide"
          >
            Bible Nova
          </motion.h1>
        </div>

        <div className="overflow-hidden mt-1">
          <motion.p
            initial={prefersReducedMotion ? false : { y: "-100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.3, delay: prefersReducedMotion ? 0 : 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="app-muted text-xs tracking-[0.3em] uppercase text-[color:var(--app-accent)]"
          >
            Companion
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}
