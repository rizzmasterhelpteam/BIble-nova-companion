import { useEffect, useRef, useState } from "react";
import { useToast } from "../context/ToastContext";

const OFFLINE_TOAST_ID = "offline-status";

export default function ConnectivityStatus() {
  const { pushToast, dismissToast } = useToast();
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const toastIdRef = useRef<string | null>(null);

  useEffect(() => {
    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  useEffect(() => {
    if (!isOffline) {
      if (toastIdRef.current) dismissToast(toastIdRef.current);
      toastIdRef.current = null;
      return;
    }

    toastIdRef.current = pushToast({
      id: OFFLINE_TOAST_ID,
      type: "warning",
      message: "You are offline. Reconnect to continue using Bible Nova Companion.",
      dismissible: true,
      action: { label: "Retry", run: () => window.location.reload() },
    });
  }, [dismissToast, isOffline, pushToast]);

  return null;
}
