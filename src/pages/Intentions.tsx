import { useEffect, useMemo, useState } from "react";
import { Heart, Plus, Trash2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { useDocumentTitle } from "../lib/utils";
import { useAuth } from "../context/AuthContext";

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
    <div className="flex flex-1 flex-col px-6 pb-6">
      <PageHeader
        eyebrow="Your Focus"
        title="Intentions"
        description="Capture what weighs on your heart so you can come back to it with clarity."
        className="mb-8 sm:mb-10"
      />

      <div className="flex gap-2 mb-4 relative z-10">
        <input
          type="text"
          value={newIntention}
          onChange={(event) => setNewIntention(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && addIntention()}
          placeholder="Add a new intention..."
          enterKeyHint="done"
          className="app-input flex-1 rounded-card px-5 py-4 text-[15px] shadow-inner transition-all"
        />
        <button
          onClick={() => addIntention()}
          disabled={!newIntention.trim()}
          aria-label="Add intention"
          className="app-primary-button flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-pill text-white transition-all active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
        >
          <Plus strokeWidth={2} className="w-6 h-6 drop-shadow-sm" />
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-8">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            onClick={() => addIntention(suggestion)}
            className="app-secondary-button rounded-pill px-3 py-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]"
          >
            {suggestion}
          </button>
        ))}
      </div>

      <div className="space-y-4 relative z-0">
        {intentions.map((intention) => (
          <div
            key={intention.id}
            className="app-panel app-card-hover flex items-start justify-between gap-4 rounded-card border p-6 group transition-all"
          >
            <div className="flex-1">
              <p className="app-heading text-[16px] leading-[1.6] font-serif font-light">
                "{intention.text}"
              </p>
              <span className="app-kicker mt-4 block text-[10px] font-medium">
                {formatRelativeTime(intention.createdAt)}
              </span>
            </div>
            <button
              onClick={() => removeIntention(intention.id)}
              className="app-soft -m-1 rounded-full p-3 transition-colors hover:bg-[color:var(--app-danger-soft)] hover:text-[color:var(--app-danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-danger)]"
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
