/**
 * Typed wrapper around the native `CantosHub` module.
 *
 * Phase 0 is 100% no-root: everything here is backed by Android special-access
 * permissions the *owner* grants (Usage Access, Write Settings, DND access,
 * Overlay, ignore-battery-optimizations) plus a foreground service. Nothing
 * requires `su`.
 *
 * If the native module isn't present (e.g. running the JS in a context where the
 * native side hasn't been built yet) every call degrades to a safe mock so the
 * UI is still explorable.
 */
import { NativeModules, Platform } from 'react-native';

export type PermissionKey =
  | 'usageAccess'
  | 'writeSettings'
  | 'dndAccess'
  | 'overlay'
  | 'ignoreBatteryOptimizations'
  | 'notifications';

export type PermissionStatus = Record<PermissionKey, boolean>;

export type Telemetry = {
  batteryLevel: number; // 0..100
  totalMem: number; // bytes
  availMem: number; // bytes
  lowMemory: boolean;
  thermalStatus: number; // -1 unknown, 0 none .. 6 shutdown
  foregroundApp: string | null;
};

export type BoostProfile = {
  id: string;
  name: string;
  /** Optional game package this profile auto-applies to (Phase 0: manual). */
  packageName?: string;
  dnd: boolean;
  peakRefreshRate: boolean;
  keepAwake: boolean;
  maxBrightness: boolean;
  // --- Pro tier (Shizuku, no root) ---
  /** 1.0 = native; <1 downscales resolution + density (e.g. 0.8). */
  resolutionScale?: number;
  /** Packages to suspend while boosting. */
  freezeApps?: string[];
};

export type ShizukuStatus = {
  available: boolean; // Shizuku running & reachable
  granted: boolean; // user authorized CantosHub
};

export type InstalledApp = {
  packageName: string;
  label: string;
};

export type GameInfo = {
  packageName: string;
  label: string;
  totalTimeMs: number; // foreground time over the last ~7 days
};

type NativeShape = {
  getPermissionStatus(): Promise<PermissionStatus>;
  openPermissionSettings(which: PermissionKey | 'appDetails'): void;
  getTelemetry(): Promise<Telemetry>;
  startBoost(profileJson: string, showOverlay: boolean): Promise<boolean>;
  startAutoBoost(profilesJson: string, showOverlay: boolean): Promise<boolean>;
  stopBoost(): Promise<boolean>;
  isBoostRunning(): Promise<boolean>;
  reconcile(): Promise<boolean>;
  setDnd(enable: boolean): Promise<boolean>;
  setMaxBrightness(enable: boolean): Promise<boolean>;
  setKeepAwake(enable: boolean): Promise<boolean>;
  setPeakRefreshRate(enable: boolean): Promise<boolean>;
  getShizukuStatus(): Promise<ShizukuStatus>;
  requestShizukuPermission(): Promise<boolean>;
  applyShizukuProfile(profileJson: string): Promise<boolean>;
  revertShizukuProfile(): Promise<boolean>;
  listInstalledApps(): Promise<InstalledApp[]>;
  listGames(): Promise<GameInfo[]>;
  launchApp(packageName: string): Promise<boolean>;
  getAppIcon(packageName: string): Promise<string | null>;
};

const native: NativeShape | undefined =
  Platform.OS === 'android' ? (NativeModules.CantosHub as NativeShape) : undefined;

export const isNativeAvailable = !!native;

const MOCK_PERMISSIONS: PermissionStatus = {
  usageAccess: false,
  writeSettings: false,
  dndAccess: false,
  overlay: false,
  ignoreBatteryOptimizations: false,
  notifications: true,
};

const MOCK_TELEMETRY: Telemetry = {
  batteryLevel: 87,
  totalMem: 8 * 1024 * 1024 * 1024,
  availMem: 3.2 * 1024 * 1024 * 1024,
  lowMemory: false,
  thermalStatus: 0,
  foregroundApp: null,
};

export const CantosHub = {
  isNativeAvailable,

  async getPermissionStatus(): Promise<PermissionStatus> {
    if (!native) return MOCK_PERMISSIONS;
    return native.getPermissionStatus();
  },

  openPermissionSettings(which: PermissionKey | 'appDetails'): void {
    native?.openPermissionSettings(which);
  },

  async getTelemetry(): Promise<Telemetry> {
    if (!native) return MOCK_TELEMETRY;
    return native.getTelemetry();
  },

  async startBoost(profile: BoostProfile, showOverlay = false): Promise<boolean> {
    if (!native) return true;
    return native.startBoost(JSON.stringify(profile), showOverlay);
  },

  async startAutoBoost(
    profiles: BoostProfile[],
    showOverlay = false,
  ): Promise<boolean> {
    if (!native) return true;
    return native.startAutoBoost(JSON.stringify(profiles), showOverlay);
  },

  async stopBoost(): Promise<boolean> {
    if (!native) return true;
    return native.stopBoost();
  },

  async isBoostRunning(): Promise<boolean> {
    if (!native) return false;
    return native.isBoostRunning();
  },

  /** Undo any lingering changes if the app was killed mid-boost. */
  async reconcile(): Promise<boolean> {
    if (!native) return true;
    return native.reconcile();
  },

  async setDnd(enable: boolean): Promise<boolean> {
    if (!native) return true;
    return native.setDnd(enable);
  },

  async setMaxBrightness(enable: boolean): Promise<boolean> {
    if (!native) return true;
    return native.setMaxBrightness(enable);
  },

  async setKeepAwake(enable: boolean): Promise<boolean> {
    if (!native) return true;
    return native.setKeepAwake(enable);
  },

  async setPeakRefreshRate(enable: boolean): Promise<boolean> {
    if (!native) return true;
    return native.setPeakRefreshRate(enable);
  },

  // --- Pro tier (Shizuku, no root) ---
  async getShizukuStatus(): Promise<ShizukuStatus> {
    if (!native) return { available: false, granted: false };
    return native.getShizukuStatus();
  },

  async requestShizukuPermission(): Promise<boolean> {
    if (!native) return false;
    return native.requestShizukuPermission();
  },

  async applyShizukuProfile(profile: BoostProfile): Promise<boolean> {
    if (!native) return true;
    return native.applyShizukuProfile(JSON.stringify(profile));
  },

  async revertShizukuProfile(): Promise<boolean> {
    if (!native) return true;
    return native.revertShizukuProfile();
  },

  async listInstalledApps(): Promise<InstalledApp[]> {
    if (!native) return [];
    return native.listInstalledApps();
  },

  async listGames(): Promise<GameInfo[]> {
    if (!native) return [];
    return native.listGames();
  },

  async launchApp(packageName: string): Promise<boolean> {
    if (!native) return true;
    return native.launchApp(packageName);
  },

  /** Base64 data-URI of the app's launcher icon, or null. */
  async getAppIcon(packageName: string): Promise<string | null> {
    if (!native) return null;
    return native.getAppIcon(packageName);
  },
};

/** Which permission each toggle needs, so the UI can lock + prompt correctly. */
export const TOGGLE_PERMISSION: Record<
  keyof Pick<
    BoostProfile,
    'dnd' | 'peakRefreshRate' | 'keepAwake' | 'maxBrightness'
  >,
  PermissionKey
> = {
  dnd: 'dndAccess',
  peakRefreshRate: 'writeSettings',
  keepAwake: 'writeSettings',
  maxBrightness: 'writeSettings',
};
