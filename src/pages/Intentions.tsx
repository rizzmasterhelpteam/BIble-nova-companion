import { useEffect, useMemo, useRef, useState } from "react";
import { Heart, Pencil, Plus, Trash2 } from "lucide-react";
import PageHeader from "../components/PageHeader";
import { cn, useDocumentTitle } from "../lib/utils";
import { useAuth } from "../context/AuthContext";
import { useMobileViewport } from "../context/MobileViewportContext";
import { storageGetJson, storageSet } from "../lib/webStorage";

type Intention = {
  id: number;
  text: string;
  createdAt: number;
};

const FALLBACK_INTENTIONS: Intention[] = [];

const SUGGESTIONS = [
  "Help me stay patient with someone I love.",
  "Give me courage for a difficult conversation.",
  "Keep my family safe and close.",
];

const formatRelativeTime = (createdAt: number, now: number) => {
  const diffMinutes = Math.max(1, Math.round((now - createdAt) / 60000));
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffMinutes < 1440) return `${Math.round(diffMinutes / 60)}h ago`;
  return `${Math.round(diffMinutes / 1440)}d ago`;
};

export default function Intentions() {
  useDocumentTitle("Intentions | Bible Nova Companion");
  const { identityKey } = useAuth();
  const { isCompactPhone, isShortPhone } = useMobileViewport();
  const [newIntention, setNewIntention] = useState("");
  const [now, setNow] = useState(Date.now());
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [removed, setRemoved] = useState<{ intention: Intention; index: number } | null>(null);
  const storageKey = useMemo(
    () => (identityKey ? `bible-nova-companion-intentions-${identityKey}` : null),
    [identityKey],
  );
  const [intentions, setIntentions] = useState<Intention[]>(FALLBACK_INTENTIONS);
  const storageTimerRef = useRef<number | null>(null);
  const undoTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!storageKey) return;

    setIntentions(storageGetJson<Intention[]>(storageKey, FALLBACK_INTENTIONS));
  }, [storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    if (storageTimerRef.current !== null) {
      window.clearTimeout(storageTimerRef.current);
    }

    storageTimerRef.current = window.setTimeout(() => {
      storageTimerRef.current = null;
      storageSet(storageKey, JSON.stringify(intentions.slice(0, 100)));
    }, 250);

    return () => {
      if (storageTimerRef.current !== null) {
        window.clearTimeout(storageTimerRef.current);
        storageTimerRef.current = null;
      }
    };
  }, [intentions, storageKey]);

  useEffect(() => () => {
    if (storageTimerRef.current !== null) {
      window.clearTimeout(storageTimerRef.current);
    }
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
    }
  }, []);

  const addIntention = (value = newIntention) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (intentions.some((item) => item.text.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) return;
    setIntentions((prev) => [{ id: Date.now(), text: trimmed, createdAt: Date.now() }, ...prev]);
    setNewIntention("");
  };

  const removeIntention = (id: number) => {
    setIntentions((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      if (index < 0) return prev;
      setRemoved({ intention: prev[index], index });
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = window.setTimeout(() => setRemoved(null), 5000);
      return prev.filter((intention) => intention.id !== id);
    });
  };

  const saveEdit = () => {
    const trimmed = editText.trim();
    if (!editingId || !trimmed) return;
    if (intentions.some((item) => item.id !== editingId && item.text.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) return;
    setIntentions((items) => items.map((item) => item.id === editingId ? { ...item, text: trimmed } : item));
    setEditingId(null);
  };

  return (
    <div
      className={cn(
        "app-scroll-region flex min-h-0 flex-1 flex-col px-4 pb-6 pt-3 sm:px-6",
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
        <label htmlFor="new-intention" className="sr-only">New intention</label>
        <input
          id="new-intention"
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
              {editingId === intention.id ? <div className="space-y-2"><label htmlFor={`edit-${intention.id}`} className="sr-only">Edit intention</label><input id={`edit-${intention.id}`} autoFocus value={editText} onChange={(event) => setEditText(event.target.value)} onKeyDown={(event) => event.key === "Enter" && saveEdit()} className="app-input w-full rounded-xl px-3 py-2 text-sm" /><div className="flex gap-2"><button onClick={saveEdit} className="app-secondary-button rounded-pill px-3 py-2 text-xs">Save</button><button onClick={() => setEditingId(null)} className="app-ghost-button rounded-pill px-3 py-2 text-xs">Cancel</button></div></div> : <p className={cn("app-heading font-serif font-light leading-[1.6]", isCompactPhone ? "text-[15px]" : "text-[16px]")}>“{intention.text}”</p>}
              <span className="app-kicker mt-4 block text-[10px] font-medium">
                {formatRelativeTime(intention.createdAt, now)}
              </span>
            </div>
            <button onClick={() => { setEditingId(intention.id); setEditText(intention.text); }} className="touch-target app-soft -m-1 rounded-full p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-input-focus)]" aria-label="Edit intention"><Pencil className="h-[18px] w-[18px]" /></button>
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
          <div className="app-panel flex flex-col items-center justify-center rounded-card border border-dashed px-8 py-10 text-center">
            <Heart className="app-soft mb-3 h-8 w-8" />
            <p className="app-muted font-serif italic">
              Your intentions list is empty. Take a moment to reflect and add one above.
            </p>
          </div>
        )}
      </div>
      {removed && <div role="status" className="app-panel-strong fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-pill px-4 py-3 text-sm shadow-xl"><span>Intention removed</span><button className="app-accent font-semibold" onClick={() => { setIntentions((items) => { const next = [...items]; next.splice(removed.index, 0, removed.intention); return next; }); setRemoved(null); }}>Undo</button></div>}
    </div>
  );
}
