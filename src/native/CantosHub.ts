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

/** An app installed since the last check (for the "add it?" prompt). */
export type NewApp = InstalledApp & { isGame: boolean };

/** What the Share sheet or the "Add game" icon shortcut asked for. */
export type PendingAdd =
  | { kind: 'pick' }
  | { kind: 'share'; packageName?: string; label?: string; installed: boolean; isGame?: boolean };

export type GameInfo = {
  packageName: string;
  label: string;
  totalTimeMs: number; // foreground time over the last ~7 days
};

export type VersionInfo = {
  versionCode: number;
  versionName: string;
};

export type GameStat = {
  sessions: number;
  avgFps: number; // 0 if no FPS samples yet
  samples: number;
};

export type FreeRamResult = {
  freedBytes: number;
  targeted: number;
  availMem: number;
  totalMem: number;
};

export type ClearCacheResult = {
  ownFreedBytes: number;
  systemTrim: boolean; // true if Shizuku trimmed all apps' caches
};

/** Result of installUpdate: download started, or user sent to grant install perm. */
export type InstallResult = 'INSTALLING' | 'NEEDS_PERMISSION';

type NativeShape = {
  getPermissionStatus(): Promise<PermissionStatus>;
  openPermissionSettings(which: PermissionKey | 'appDetails'): void;
  getTelemetry(): Promise<Telemetry>;
  startBoost(profileJson: string, showOverlay: boolean, freeRam: boolean): Promise<boolean>;
  startAutoBoost(
    profilesJson: string,
    showOverlay: boolean,
    freeRam: boolean,
  ): Promise<boolean>;
  stopBoost(): Promise<boolean>;
  isBoostRunning(): Promise<boolean>;
  updateAutoProfiles(profilesJson: string): Promise<boolean>;
  kidsGetConfig(): Promise<KidsConfig>;
  kidsSetAllowed(json: string): Promise<boolean>;
  kidsSetPin(oldPin: string, newPin: string): Promise<boolean>;
  kidsStart(): Promise<KidsStartResult>;
  kidsStop(pin: string): Promise<boolean>;
  kidsUnlockWithDeviceCredential(): Promise<boolean>;
  openAccessibilitySettings(): Promise<boolean>;
  kidsRequestHomeRole(): Promise<boolean>;
  openHomeChooser(): Promise<boolean>;
  openAppInfo(packageName: string): Promise<boolean>;
  getScreenBrightness(): Promise<{ level: number; auto: boolean; canWrite: boolean }>;
  setScreenBrightness(level: number, auto: boolean): Promise<boolean>;
  blockedBoosterPackages(): Promise<string[]>;
  getProLeftovers(): Promise<{ frozenApps: number; resolutionChanged: boolean }>;
  openLauncherHideApps(): Promise<'samsung' | 'home' | ''>;
  getCapabilities(): Promise<Capabilities>;
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
  listGames(extraJson: string): Promise<GameInfo[]>;
  listAppsInstalledSince(sinceMs: number): Promise<NewApp[]>;
  takePendingAdd(): Promise<PendingAdd | null>;
  launchApp(packageName: string): Promise<boolean>;
  getAppIcon(packageName: string): Promise<string | null>;
  getVersionInfo(): Promise<VersionInfo>;
  installUpdate(url: string): Promise<InstallResult>;
  getGameStats(): Promise<Record<string, GameStat>>;
  freeRam(): Promise<FreeRamResult>;
  clearCaches(): Promise<ClearCacheResult>;
  uninstallApp(packageName: string): Promise<boolean>;
  openDevSettings(): Promise<boolean>;
  getGameBoosterStatus(): Promise<GameBoosterStatus>;
  setGameBoosterBlocked(blocked: boolean): Promise<boolean>;
  hideApp(packageName: string): Promise<boolean>;
  unhideApp(packageName: string): Promise<boolean>;
  setQuickTileProfile(profileJson: string): Promise<boolean>;
  requestAddTile(): Promise<boolean>;
  setGameShortcuts(jsonArray: string): Promise<boolean>;
  pinGameShortcut(json: string): Promise<boolean>;
};

export type KidsConfig = {
  active: boolean; // Kids Mode is on (the lock should be running)
  running: boolean; // the lock service is running right now
  hasPin: boolean;
  allowed: string[]; // package names the kid may open
  deviceSecure: boolean; // phone has a screen lock (used as "forgot PIN" fallback)
  strongLock: boolean; // Shizuku available: also locks the shade/Recents + Home
  a11yLock: boolean; // CantosHub Kids lock accessibility helper is on (no Shizuku needed)
  restricted: 'allowed' | 'denied' | 'unknown'; // Android 13+ restricted settings for sideloaded apps
  homeRole: boolean; // CantosHub is the default Home app (Kids Mode Home without Shizuku)
  homeRoleTaken: boolean; // Kids Mode ended but still holds the borrowed Home: offer the picker
  gestureNav: boolean; // phone uses swipe gestures: Kids Mode must not take over Home (Samsung disables gestures)
};

export type KidsStartResult = 'OK' | 'NO_PIN' | 'NO_APPS' | 'NO_OVERLAY' | 'NO_USAGE';

/** What this device supports (so no-op toggles can be hidden). */
export type Capabilities = {
  peakRefreshRate: boolean; // AOSP peak_refresh_rate exists (not on Samsung One UI)
  samsung: boolean;
};

export type GameBoosterStatus = {
  present: boolean; // Samsung Game Booster components exist on this device
  blocked: boolean; // they're currently disabled
  components: string[]; // friendly names of the components found
};

/** One game's launcher shortcut spec (Boost & Play). */
export type ShortcutSpec = {
  id: string;
  label: string;
  packageName: string;
  profile: BoostProfile;
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

  async startBoost(
    profile: BoostProfile,
    showOverlay = false,
    freeRam = true,
  ): Promise<boolean> {
    if (!native) return true;
    return native.startBoost(JSON.stringify(profile), showOverlay, freeRam);
  },

  async startAutoBoost(
    profiles: BoostProfile[],
    showOverlay = false,
    freeRam = true,
  ): Promise<boolean> {
    if (!native) return true;
    return native.startAutoBoost(JSON.stringify(profiles), showOverlay, freeRam);
  },

  async stopBoost(): Promise<boolean> {
    if (!native) return true;
    return native.stopBoost();
  },

  async isBoostRunning(): Promise<boolean> {
    if (!native) return false;
    return native.isBoostRunning();
  },

  // --- Kids Mode ---
  async kidsGetConfig(): Promise<KidsConfig> {
    if (!native) {
      return { active: false, running: false, hasPin: false, allowed: [], deviceSecure: false, strongLock: false, a11yLock: false, restricted: 'unknown', homeRole: false, homeRoleTaken: false, gestureNav: false };
    }
    return native.kidsGetConfig();
  },

  async kidsSetAllowed(pkgs: string[]): Promise<boolean> {
    if (!native) return true;
    return native.kidsSetAllowed(JSON.stringify(pkgs));
  },

  async kidsSetPin(oldPin: string, newPin: string): Promise<boolean> {
    if (!native) return true;
    return native.kidsSetPin(oldPin, newPin);
  },

  async kidsStart(): Promise<KidsStartResult> {
    if (!native) return 'OK';
    return native.kidsStart();
  },

  async kidsStop(pin: string): Promise<boolean> {
    if (!native) return true;
    return native.kidsStop(pin);
  },

  async kidsUnlockWithDeviceCredential(): Promise<boolean> {
    if (!native) return false;
    return native.kidsUnlockWithDeviceCredential();
  },

  async openAccessibilitySettings(): Promise<boolean> {
    if (!native) return false;
    return native.openAccessibilitySettings();
  },

  /** Android's "set as default Home app" prompt for the kids screen. True if granted. */
  async kidsRequestHomeRole(): Promise<boolean> {
    if (!native) return false;
    return native.kidsRequestHomeRole();
  },

  /** Current screen brightness (0..255) and whether adaptive brightness is on. */
  async getScreenBrightness(): Promise<{ level: number; auto: boolean; canWrite: boolean }> {
    if (!native) return { level: 128, auto: false, canWrite: false };
    return native.getScreenBrightness();
  },

  /** Set brightness: auto = adaptive; otherwise manual at level (1..255). */
  async setScreenBrightness(level: number, auto = false): Promise<boolean> {
    if (!native) return false;
    return native.setScreenBrightness(Math.round(level), auto);
  },

  /** Any app's App info page (Enable a disabled app without Shizuku). */
  async openAppInfo(packageName: string): Promise<boolean> {
    if (!native) return false;
    return native.openAppInfo(packageName);
  },

  /** Samsung Game Booster parts that are currently disabled. */
  async blockedBoosterPackages(): Promise<string[]> {
    if (!native) return [];
    return native.blockedBoosterPackages();
  },

  /** PRO changes still in place (frozen apps / lowered resolution) that need Shizuku to undo. */
  async getProLeftovers(): Promise<{ frozenApps: number; resolutionChanged: boolean }> {
    if (!native) return { frozenApps: 0, resolutionChanged: false };
    return native.getProLeftovers();
  },

  /** After Kids Mode: Android's "Select a Home app" so the parent picks their usual Home. */
  async openHomeChooser(): Promise<boolean> {
    if (!native) return false;
    return native.openHomeChooser();
  },

  /** Open the launcher's settings (Samsung: "Hide apps on Home and Apps screens"). */
  async openLauncherHideApps(): Promise<'samsung' | 'home' | ''> {
    if (!native) return '';
    return native.openLauncherHideApps();
  },

  /** Push edited profiles to a running Auto boost (no restart, no re-boost). */
  async updateAutoProfiles(profiles: BoostProfile[]): Promise<boolean> {
    if (!native) return true;
    return native.updateAutoProfiles(JSON.stringify(profiles));
  },

  async getCapabilities(): Promise<Capabilities> {
    if (!native) return { peakRefreshRate: true, samsung: false };
    return native.getCapabilities();
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

  /** Android-tagged games plus [extra] packages the user added themselves. */
  async listGames(extra: string[] = []): Promise<GameInfo[]> {
    if (!native) return [];
    return native.listGames(JSON.stringify(extra));
  },

  async listAppsInstalledSince(sinceMs: number): Promise<NewApp[]> {
    if (!native) return [];
    return native.listAppsInstalledSince(sinceMs);
  },

  async takePendingAdd(): Promise<PendingAdd | null> {
    if (!native) return null;
    return native.takePendingAdd();
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

  async getVersionInfo(): Promise<VersionInfo> {
    if (!native) return { versionCode: 0, versionName: 'dev' };
    return native.getVersionInfo();
  },

  async installUpdate(url: string): Promise<InstallResult> {
    if (!native) return 'INSTALLING';
    return native.installUpdate(url);
  },

  async getGameStats(): Promise<Record<string, GameStat>> {
    if (!native) return {};
    return native.getGameStats();
  },

  async freeRam(): Promise<FreeRamResult> {
    if (!native) {
      return { freedBytes: 0, targeted: 0, availMem: 0, totalMem: 0 };
    }
    return native.freeRam();
  },

  async clearCaches(): Promise<ClearCacheResult> {
    if (!native) return { ownFreedBytes: 0, systemTrim: false };
    return native.clearCaches();
  },

  async uninstallApp(packageName: string): Promise<boolean> {
    if (!native) return true;
    return native.uninstallApp(packageName);
  },

  /** Open Developer Options (for the in-app Shizuku / wireless-debugging setup). */
  async openDevSettings(): Promise<boolean> {
    if (!native) return true;
    return native.openDevSettings();
  },

  async getGameBoosterStatus(): Promise<GameBoosterStatus> {
    if (!native) return { present: false, blocked: false, components: [] };
    return native.getGameBoosterStatus();
  },

  /** Block/unblock Samsung's Game Booster (Shizuku). Returns false if not granted. */
  async setGameBoosterBlocked(blocked: boolean): Promise<boolean> {
    if (!native) return false;
    return native.setGameBoosterBlocked(blocked);
  },

  /** Hide a game from the launcher (Shizuku). Returns false if Shizuku isn't granted. */
  async hideApp(packageName: string): Promise<boolean> {
    if (!native) return false;
    return native.hideApp(packageName);
  },

  async unhideApp(packageName: string): Promise<boolean> {
    if (!native) return false;
    return native.unhideApp(packageName);
  },

  async setQuickTileProfile(profile: BoostProfile): Promise<boolean> {
    if (!native) return true;
    return native.setQuickTileProfile(JSON.stringify(profile));
  },

  async requestAddTile(): Promise<boolean> {
    if (!native) return false;
    return native.requestAddTile();
  },

  async setGameShortcuts(items: ShortcutSpec[]): Promise<boolean> {
    if (!native) return true;
    const payload = items.map(s => ({
      id: s.id,
      label: s.label,
      packageName: s.packageName,
      profile: JSON.stringify(s.profile),
    }));
    return native.setGameShortcuts(JSON.stringify(payload));
  },

  async pinGameShortcut(spec: ShortcutSpec): Promise<boolean> {
    if (!native) return false;
    return native.pinGameShortcut(
      JSON.stringify({
        id: spec.id,
        label: spec.label,
        packageName: spec.packageName,
        profile: JSON.stringify(spec.profile),
      }),
    );
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
