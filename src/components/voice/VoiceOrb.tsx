import type { CSSProperties } from "react";
import { Mic, MicOff } from "lucide-react";
import { cn } from "../../lib/utils";
import type { VoiceState } from "../../types/live";

type VoiceVisualMode =
  | "settled"
  | "listening"
  | "user-speaking"
  | "reflecting"
  | "assistant-speaking"
  | "paused"
  | "unavailable";

type VoiceOrbProps = {
  state: VoiceState;
  inputLevel: number;
  isPerformanceMode: boolean;
  compact?: boolean;
  className?: string;
};

type VoiceOrbStyle = CSSProperties & {
  "--voice-core-scale": string;
  "--voice-level-scale": string;
};

const VOICE_VISUAL_MODES: Record<VoiceState, VoiceVisualMode> = {
  idle: "settled",
  "requesting-permission": "reflecting",
  connecting: "reflecting",
  ready: "settled",
  listening: "listening",
  "user-speaking": "user-speaking",
  "finishing-user-turn": "reflecting",
  transcribing: "reflecting",
  thinking: "reflecting",
  "preparing-voice": "reflecting",
  "assistant-speaking": "assistant-speaking",
  "barge-in-listening": "listening",
  interrupted: "listening",
  "restarting-listener": "reflecting",
  paused: "paused",
  reconnecting: "reflecting",
  ending: "reflecting",
  ended: "settled",
  "permission-denied": "unavailable",
  offline: "unavailable",
  error: "unavailable",
};

const WAVE_BAR_HEIGHTS = [8, 12, 17, 11, 15, 9, 18, 12, 16, 10, 14, 9];
const PARTICLES = [
  { left: "15%", top: "35%", delay: "-0.4s", duration: "4.8s", size: "2px" },
  { left: "25%", top: "12%", delay: "-2.1s", duration: "5.4s", size: "3px" },
  { left: "76%", top: "18%", delay: "-1.2s", duration: "4.5s", size: "2px" },
  { left: "86%", top: "48%", delay: "-3.3s", duration: "5.8s", size: "2px" },
  { left: "68%", top: "82%", delay: "-2.7s", duration: "4.9s", size: "3px" },
  { left: "20%", top: "73%", delay: "-1.7s", duration: "5.2s", size: "2px" },
];

const isMicrophoneUnavailable = (state: VoiceState) =>
  state === "paused" || state === "permission-denied";

export function VoiceOrb({
  state,
  inputLevel,
  isPerformanceMode,
  compact = false,
  className,
}: VoiceOrbProps) {
  const visualMode = VOICE_VISUAL_MODES[state];
  const level = Math.min(1, Math.max(0, inputLevel));
  const style: VoiceOrbStyle = {
    "--voice-core-scale": (1 + level * 0.045).toFixed(3),
    "--voice-level-scale": (0.72 + level * 1.45).toFixed(3),
  };
  const MicrophoneIcon = isMicrophoneUnavailable(state) ? MicOff : Mic;

  return (
    <div
      aria-hidden="true"
      className={cn(
        "voice-orb relative isolate flex shrink-0 items-center justify-center",
        compact ? "h-[128px] w-[128px]" : "h-36 w-36 sm:h-40 sm:w-40",
        `voice-orb--${visualMode}`,
        isPerformanceMode && "voice-orb--performance",
        className,
      )}
      data-voice-visual={visualMode}
      style={style}
    >
      <span className="voice-orb-ambient absolute rounded-full" />

      <span className="voice-orb-layer voice-listening-layer absolute inset-0">
        {[0, 1, 2].map((ring) => (
          <span
            key={ring}
            className="voice-listening-ring absolute rounded-full border"
            style={{ animationDelay: `${ring * -1.08}s` }}
          />
        ))}
      </span>

      {!isPerformanceMode && (
        <span className="voice-orb-layer voice-wave-halo absolute inset-0">
          {WAVE_BAR_HEIGHTS.map((height, index) => (
            <span
              key={`${height}-${index}`}
              className="voice-wave-spoke absolute inset-[3px]"
              style={{ transform: `rotate(${index * 30}deg)` }}
            >
              <span
                className="voice-wave-bar absolute rounded-full"
                style={{ height: `${height}px` }}
              />
            </span>
          ))}
        </span>
      )}

      <span className="voice-orb-layer voice-thinking-layer absolute inset-[3px] rounded-full">
        <span className="voice-thinking-halo absolute inset-0 rounded-full border" />
        {!isPerformanceMode && (
          <span className="voice-thinking-dots absolute inset-0">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="voice-thinking-dot absolute rounded-full"
                style={{ transform: `rotate(${dot * 120}deg)` }}
              >
                <span className="absolute rounded-full" />
              </span>
            ))}
          </span>
        )}
      </span>

      <span className="voice-orb-layer voice-assistant-layer absolute inset-0">
        {[0, 1].map((ripple) => (
          <span
            key={ripple}
            className="voice-assistant-ripple absolute rounded-full border"
            style={{ animationDelay: `${ripple * 0.72}s` }}
          />
        ))}
        {!isPerformanceMode && (
          <span className="voice-assistant-orbit absolute inset-[3px]">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((dot) => (
              <span
                key={dot}
                className="voice-assistant-spoke absolute inset-0"
                style={{ transform: `rotate(${dot * 45}deg)` }}
              >
                <span className="voice-assistant-dot absolute rounded-full" />
              </span>
            ))}
          </span>
        )}
      </span>

      {!isPerformanceMode && (
        <span className="voice-orb-particles absolute inset-0">
          {PARTICLES.map((particle, index) => (
            <span
              key={index}
              className="voice-orb-particle absolute rounded-full"
              style={{
                animationDelay: particle.delay,
                animationDuration: particle.duration,
                height: particle.size,
                left: particle.left,
                top: particle.top,
                width: particle.size,
              }}
            />
          ))}
        </span>
      )}

      <span className="voice-orb-core-shell relative z-10 flex h-24 w-24 items-center justify-center sm:h-28 sm:w-28">
        <span className="voice-orb-core absolute inset-0 rounded-full border" />
        <span className="voice-orb-core-glint absolute inset-[7px] rounded-full" />
        <MicrophoneIcon
          className="voice-orb-icon relative z-10 h-10 w-10 sm:h-12 sm:w-12"
          strokeWidth={1.5}
        />
      </span>
    </div>
  );
}
