import { useEffect, useRef, useState } from "react";
import { useToast } from "../context/ToastContext";
import { getPlatformAdapter } from "../lib/native/platform";

const OFFLINE_TOAST_ID = "offline-status";

export default function ConnectivityStatus() {
  const { pushToast, dismissToast } = useToast();
  const [isOffline, setIsOffline] = useState(
    typeof navigator !== "undefined" && navigator.onLine === false,
  );
  const toastIdRef = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const updateNetworkState = ({ connected }: { connected: boolean }) => {
      if (mounted) setIsOffline(!connected);
    };
    const network = getPlatformAdapter().network;
    const unsubscribe = network.subscribe(updateNetworkState);
    void network.getStatus().then(updateNetworkState).catch(() => undefined);

    return () => {
      mounted = false;
      unsubscribe();
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
      message: "No internet connection. Voice and online features will resume when you reconnect.",
      dismissible: false,
    });
  }, [dismissToast, isOffline, pushToast]);

  return null;
}
