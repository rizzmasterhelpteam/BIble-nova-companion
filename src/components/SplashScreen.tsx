import React from "react";
import { motion } from "motion/react";

export function SplashScreen() {
  return (
    <motion.div 
      className="app-screen fixed inset-0 z-[100] flex w-full flex-col items-center justify-center overflow-hidden bg-[color:var(--app-bg)]"
      exit={{ opacity: 0, scale: 1.05 }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
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
            animate={{
              scale: [1, 1.5, 1],
              opacity: [0.2, 0.5, 0.2],
            }}
            transition={{
              duration: 4,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          />

          {/* Central Elegant Cross */}
          <motion.svg
            viewBox="0 0 100 100"
            className="absolute h-16 w-16 text-[color:var(--app-accent)] drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]"
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
                  transition: { duration: 1.8, ease: "easeInOut" }
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
                  transition: { delay: 1.0, duration: 1.5, ease: [0.22, 1, 0.36, 1] }
                }
              }}
              style={{ originX: "50px", originY: "50px" }}
            />
          </motion.svg>

          {/* Orbiting particle 1 */}
          <motion.div
            className="absolute h-1.5 w-1.5 rounded-full bg-[color:var(--app-accent)] shadow-[0_0_10px_currentColor]"
            animate={{
              rotate: [0, 360],
              x: [0, 35, 0, -35, 0],
              y: [-35, 0, 35, 0, -35],
              scale: [1, 1.5, 1, 1.5, 1],
            }}
            transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
          />
        </div>

        {/* Minimal Typography Entrance */}
        <div className="overflow-hidden">
          <motion.h1
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            transition={{ duration: 0.8, delay: 1.2, ease: [0.22, 1, 0.36, 1] }}
            className="app-heading font-serif text-[2.5rem] font-normal tracking-wide text-white"
          >
            Bible Nova
          </motion.h1>
        </div>

        <div className="overflow-hidden mt-1">
          <motion.p
            initial={{ y: "-100%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, delay: 1.5, ease: [0.22, 1, 0.36, 1] }}
            className="app-muted text-xs tracking-[0.3em] uppercase text-[color:var(--app-accent)]"
          >
            Companion
          </motion.p>
        </div>
      </div>
    </motion.div>
  );
}
