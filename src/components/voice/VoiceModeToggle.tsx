import React from "react";
import { MessageCircle, Mic } from "lucide-react";
import { cn } from "../../lib/utils";
import type { HomeMode } from "../../types/live";

type VoiceModeToggleProps = {
  value: HomeMode;
  onChange: (mode: HomeMode) => void;
  className?: string;
};

export function VoiceModeToggle({ value, onChange, className }: VoiceModeToggleProps) {
  return (
    <div
      role="group"
      aria-label="Home mode"
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-pill border p-0.5",
        className,
      )}
      style={{
        background: "var(--app-secondary-bg)",
        borderColor: "var(--app-secondary-border)",
      }}
    >
      {([
        ["voice", "Voice", Mic],
        ["chat", "Chat", MessageCircle],
      ] as const).map(([mode, label, Icon]) => {
        const isSelected = value === mode;
        return (
          <button
            key={mode}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onChange(mode)}
            className="touch-target inline-flex min-h-8 items-center justify-center gap-1.5 rounded-pill px-2.5 text-[11px] font-semibold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
            style={{
              background: isSelected ? "var(--app-surface-solid)" : "transparent",
              color: isSelected ? "var(--app-accent)" : "var(--app-text-muted)",
              boxShadow: isSelected ? "0 2px 10px rgba(0,0,0,0.12)" : "none",
            }}
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={2} aria-hidden="true" />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
