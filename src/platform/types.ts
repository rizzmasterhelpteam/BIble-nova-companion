import {
  API_CONTRACT_VERSION,
  NATIVE_BRIDGE_VERSION,
} from "../../platform-contract";

export { API_CONTRACT_VERSION, NATIVE_BRIDGE_VERSION };

export type PlatformKind = "web" | "android" | "ios" | "unknown";

export type NetworkStatus = {
  connected: boolean;
  connectionType?: string;
};

export type AppState = {
  active: boolean;
};

export type ReminderSchedule = {
  hour: number;
  minute: number;
  days: number[];
};

export type ReminderStatus = {
  permissionGranted: boolean;
  /** Android 12+ can disable exact alarms separately from notifications. */
  exactAlarmGranted?: boolean;
  schedules: Array<{
    id: number;
    day: number;
    hour: number | null;
    minute: number | null;
  }>;
};

export type PlatformAdapter = {
  kind: PlatformKind;
  isNative: boolean;
  nativeBridgeVersion: typeof NATIVE_BRIDGE_VERSION;
  apiContractVersion: typeof API_CONTRACT_VERSION;
  getAppVersion: () => string;
  auth: {
    signInWithGoogle: () => Promise<void>;
  };
  purchases: {
    supported: boolean;
    restore: () => Promise<unknown>;
    openManagement: () => Promise<void>;
  };
  reminders: {
    supported: boolean;
    getId: (day: number) => number;
    getStatus: () => Promise<ReminderStatus>;
    schedule: (schedule: ReminderSchedule) => Promise<boolean>;
    cancel: () => Promise<void>;
  };
  haptics: {
    impact: (style?: "LIGHT" | "MEDIUM" | "HEAVY") => Promise<void>;
    notification: (type?: "SUCCESS" | "WARNING" | "ERROR") => Promise<void>;
  };
  network: {
    getStatus: () => Promise<NetworkStatus>;
    subscribe: (listener: (status: NetworkStatus) => void) => () => void;
  };
  appState: {
    subscribe: (listener: (state: AppState) => void) => () => void;
  };
  backButton: {
    subscribe: (listener: () => void) => () => void;
  };
};
