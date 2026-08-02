import { X } from "lucide-react";
import { useToast } from "../context/ToastContext";

const colors = {
  info: "var(--app-accent)",
  success: "var(--app-success)",
  warning: "var(--app-warning, var(--app-accent))",
  error: "var(--app-danger)",
};

export default function ToastViewport() {
  const { toasts, dismissToast } = useToast();
  if (!toasts.length) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-3 z-[60] flex flex-col items-center gap-2"
      style={{ top: "calc(0.75rem + env(safe-area-inset-top, 0px))" }}
      aria-live="polite"
    >
      <div className="flex w-full max-w-lg flex-col gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role={toast.type === "error" ? "alert" : "status"}
            className="pointer-events-auto flex items-start gap-3 rounded-card border px-4 py-3 text-sm shadow-lg"
            style={{
              background: "var(--app-surface-elevated)",
              borderColor: "var(--app-card-border)",
              color: "var(--app-text)",
              borderLeftColor: colors[toast.type],
            }}
          >
            <span className="min-w-0 flex-1 leading-relaxed">{toast.message}</span>
            {toast.action && (
              <button
                type="button"
                className="touch-target shrink-0 rounded-pill px-2 py-1 text-xs font-semibold"
                style={{ color: colors[toast.type] }}
                onClick={() => {
                  toast.action?.run();
                  dismissToast(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            {toast.dismissible && (
              <button
                type="button"
                className="touch-target shrink-0 rounded-full p-1 app-muted"
                aria-label="Dismiss notification"
                onClick={() => dismissToast(toast.id)}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
