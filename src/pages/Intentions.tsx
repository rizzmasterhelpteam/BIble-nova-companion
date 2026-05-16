import { useEffect, useMemo, useState } from "react";
import { Heart, Plus, Trash2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { cn, useDocumentTitle } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import { useMobileViewport } from "../context/MobileViewportContext";

type Intention = {
  id: number;
  text: string;
  createdAt: number;
};

const FALLBACK_INTENTIONS: Intention[] = [
  { id: 1, text: "Pray for my friend's quick recovery.", createdAt: Date.now() - 1000 * 60 * 60 * 2 },
];

const SUGGESTIONS = [
  "Help me stay patient with someone I love.",
  "Give me courage for a difficult conversation.",
  "Keep my family safe and close.",
];

const formatRelativeTime = (createdAt: number) => {
  const diffMinutes = Math.max(1, Math.round((Date.now() - createdAt) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)}h ago`;
  return `${Math.round(diffMinutes / 1440)}d ago`;
};

export default function Intentions() {
  useDocumentTitle("Intentions | Bible Nova Companion");
  const { identityKey } = useAuth();
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const [newIntention, setNewIntention] = useState("");
  const storageKey = useMemo(
    () => (identityKey ? `bible-nova-companion-intentions-${identityKey}` : null),
    [identityKey],
  );
  const [intentions, setIntentions] = useState<Intention[]>(FALLBACK_INTENTIONS);

  useEffect(() => {
    if (!storageKey) return;

    try {
      const raw = localStorage.getItem(storageKey);
      setIntentions(raw ? (JSON.parse(raw) as Intention[]) : FALLBACK_INTENTIONS);
    } catch {
      setIntentions(FALLBACK_INTENTIONS);
    }
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify(intentions));
  }, [intentions, storageKey]);

  const addIntention = (value = newIntention) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    setIntentions((prev) => [{ id: Date.now(), text: trimmed, createdAt: Date.now() }, ...prev]);
    setNewIntention("");
  };

  const removeIntention = (id: number) => {
    setIntentions((prev) => prev.filter((intention) => intention.id !== id));
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pb-6 pt-3 sm:px-6",
        isCompactPhone && "px-3 pb-5 pt-2",
      )}
    >
      <PageHeader
        eyebrow="Your Focus"
        title="Intentions"
        description="Capture what weighs on your heart so you can come back to it with clarity."
        className={cn(isShortPhone ? "mb-6" : "mb-8 sm:mb-10")}
      />

      <div className={cn("relative z-10 mb-4 flex gap-2", isCompactPhone && "mb-3")}>
        <input
          type="text"
          value={newIntention}
          onChange={(event) => setNewIntention(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && addIntention()}
          placeholder="Add a new intention..."
          enterKeyHint="done"
          className={cn(
            "app-input flex-1 rounded-card px-4 shadow-inner transition-all",
            isCompactPhone ? "py-3.5 text-[14px]" : "py-4 text-[15px]",
          )}
        />
        <button
          onClick={() => addIntention()}
          disabled={!newIntention.trim()}
          aria-label="Add intention"
          className={cn(
            "touch-target app-primary-button flex flex-shrink-0 items-center justify-center rounded-pill text-white transition-all active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]",
            isCompactPhone ? "h-12 w-12" : "h-14 w-14",
          )}
        >
          <Plus strokeWidth={2} className="w-6 h-6 drop-shadow-sm" />
        </button>
      </div>

      <div className={cn("mb-6 flex flex-wrap gap-2", !isShortPhone && "sm:mb-8")}>
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => addIntention(suggestion)}
            className="touch-target app-secondary-button rounded-pill px-3 py-2 text-[11px] leading-tight transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="relative z-0 space-y-3">
        {intentions.map((intention) => (
          <div
            key={intention.id}
            className={cn(
              "app-panel app-card-hover group flex items-start justify-between gap-4 rounded-card border transition-all",
              isCompactPhone ? "p-4" : "p-5 sm:p-6",
            )}
          >
            <div className="flex-1">
              <p className={cn("app-heading font-serif font-light leading-[1.6]", isCompactPhone ? "text-[15px]" : "text-[16px]")}>
                "{intention.text}"
              </p>
              <span className="app-kicker mt-4 block text-[10px] font-medium">
                {formatRelativeTime(intention.createdAt)}
              </span>
            </div>
            <button
              onClick={() => removeIntention(intention.id)}
              className="touch-target app-soft -m-1 rounded-full p-3 transition-colors hover:bg-[color:var(--app-danger-soft)] hover:text-[color:var(--app-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-danger)]"
              aria-label="Remove intention"
              title="Remove intention"
            >
              <Trash2 className="w-[18px] h-[18px]" strokeWidth={1.5} />
            </button>
          </div>
        ))}

        {intentions.length === 0 && (
          <div className="app-panel flex flex-col items-center justify-center rounded-card border border-dashed px-8 py-16 text-center">
            <Heart className="app-soft mb-4 w-10 h-10" />
            <p className="app-muted font-serif italic">
              Your intentions list is empty. Take a moment to reflect and add one above.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
