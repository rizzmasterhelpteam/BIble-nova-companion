export type RealtimeInputSession = {
  sendRealtimeInput: (input: unknown) => void;
};

export type ReconnectLifecycleState = {
  intentionalStop: boolean;
  active: boolean;
  appActive: boolean;
  visibilityPaused: boolean;
};

export const canStartReconnect = ({
  intentionalStop,
  active,
  appActive,
  visibilityPaused,
}: ReconnectLifecycleState) =>
  !intentionalStop && active && appActive && !visibilityPaused;

/**
 * Resolves the target at send time so a long-lived microphone processor never
 * retains a socket that was replaced during a reconnect.
 */
export const createCurrentSessionRouter = <T extends RealtimeInputSession>(
  getCurrentSession: () => T | null,
) => ({
  send(input: unknown) {
    const session = getCurrentSession();
    if (!session) return false;
    session.sendRealtimeInput(input);
    return true;
  },
});

export const closeLateSession = <T extends { close: () => void }>(
  session: T,
  isStillCurrent: () => boolean,
) => {
  if (isStillCurrent()) return false;
  try { session.close(); } catch { /* already closed */ }
  return true;
};

export const withOperationTimeout = async <T>(
  operation: Promise<T>,
  timeoutMs: number,
  message: string,
) => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
  });
  try {
    return await Promise.race([operation, timeoutPromise]);
  } finally {
    if (timeout !== null) clearTimeout(timeout);
  }
};
