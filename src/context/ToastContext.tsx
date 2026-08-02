import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type Toast = {
  id: string;
  type: "info" | "success" | "warning" | "error";
  message: string;
  action?: { label: string; run: () => void };
  dismissible: boolean;
  durationMs?: number;
};

type ToastOptions = Omit<Toast, "id"> & { id?: string };

type ToastContextValue = {
  toasts: Toast[];
  pushToast: (toast: ToastOptions) => string;
  dismissToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue>({
  toasts: [],
  pushToast: () => "",
  dismissToast: () => {},
});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((toast: ToastOptions) => {
    const id = toast.id || `toast-${++idRef.current}`;
    setToasts((current) => {
      const next = current.filter((existing) => existing.id !== id);
      return [...next, { ...toast, id }];
    });
    return id;
  }, []);

  useEffect(() => {
    const timers = toasts
      .filter((toast) => toast.durationMs && toast.durationMs > 0)
      .map((toast) => window.setTimeout(() => dismissToast(toast.id), toast.durationMs));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [dismissToast, toasts]);

  const value = useMemo(() => ({ toasts, pushToast, dismissToast }), [dismissToast, pushToast, toasts]);
  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export const useToast = () => useContext(ToastContext);
