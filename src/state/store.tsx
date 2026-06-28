/**
 * Lightweight global store (React context) shared across screens:
 * profiles, the active profile, granted permissions, and boost on/off state.
 *
 * Phase 0 keeps profiles in memory. Persisting them (AsyncStorage) is a tiny
 * follow-up — left out here to keep the scaffold dependency-free.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { CHANGELOG } from '../changelog';
import {
  BoostProfile,
  CantosHub,
  PermissionStatus,
  ShizukuStatus,
  TOGGLE_PERMISSION,
} from '../native/CantosHub';

const STORAGE_KEY = 'cantoshub_state_v1';
const LAST_SEEN_KEY = 'cantoshub_last_seen_code';
const VERSIONS_URL =
  'https://raw.githubusercontent.com/getw0rk3d/CantosHub/main/versions.json';

export type UpdateState = {
  available: boolean;
  versionName?: string;
  apkUrl?: string;
  notes?: string;
};

export type WhatsNew = {
  versionName: string;
  notes: string;
};

export type ToggleKey = 'dnd' | 'peakRefreshRate' | 'keepAwake' | 'maxBrightness';

const DEFAULT_PROFILES: BoostProfile[] = [
  {
    id: 'balanced',
    name: 'Balanced',
    dnd: true,
    peakRefreshRate: true,
    keepAwake: true,
    maxBrightness: false,
  },
  {
    id: 'competitive',
    name: 'FPS / Competitive',
    dnd: true,
    peakRefreshRate: true,
    keepAwake: true,
    maxBrightness: true,
  },
  {
    id: 'chill',
    name: 'Battery saver',
    dnd: true,
    peakRefreshRate: false,
    keepAwake: false,
    maxBrightness: false,
  },
];

let idCounter = 0;
function newId(): string {
  idCounter += 1;
  return `profile_${Date.now()}_${idCounter}`;
}

type Store = {
  profiles: BoostProfile[];
  activeProfileId: string;
  activeProfile: BoostProfile;
  setActiveProfileId: (id: string) => void;
  updateProfile: (id: string, patch: Partial<BoostProfile>) => void;
  addProfile: (name: string) => string;
  deleteProfile: (id: string) => void;
  /** Bind a game to a profile (and unbind it from any other profile). */
  assignGameToProfile: (profileId: string, packageName: string) => void;

  permissions: PermissionStatus | null;
  refreshPermissions: () => Promise<void>;

  shizuku: ShizukuStatus | null;
  refreshShizuku: () => Promise<void>;
  requestShizuku: () => Promise<void>;

  autoMode: boolean;
  setAutoMode: (v: boolean) => void;
  showOverlay: boolean;
  setShowOverlay: (v: boolean) => void;
  freeRamOnBoost: boolean;
  setFreeRamOnBoost: (v: boolean) => void;

  update: UpdateState | null;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;

  whatsNew: WhatsNew | null;
  dismissWhatsNew: () => void;

  boostRunning: boolean;
  startBoost: () => Promise<void>;
  stopBoost: () => Promise<void>;
  /** Start a manual boost using a specific profile (used by Games → Boost & Play). */
  boostGame: (profile: BoostProfile) => Promise<void>;
  /** Flip one toggle on the active profile; applies live if boost is running. */
  toggle: (key: ToggleKey, value: boolean) => Promise<void>;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<BoostProfile[]>(DEFAULT_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState<string>('balanced');
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [shizuku, setShizuku] = useState<ShizukuStatus | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [freeRamOnBoost, setFreeRamOnBoost] = useState(true);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [whatsNew, setWhatsNew] = useState<WhatsNew | null>(null);
  const [boostRunning, setBoostRunning] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const activeProfile = useMemo(
    () => profiles.find(p => p.id === activeProfileId) ?? profiles[0],
    [profiles, activeProfileId],
  );
  const activeRef = useRef(activeProfile);
  activeRef.current = activeProfile;
  const profilesRef = useRef(profiles);
  profilesRef.current = profiles;
  const shizukuRef = useRef(shizuku);
  shizukuRef.current = shizuku;
  const autoRef = useRef(autoMode);
  autoRef.current = autoMode;
  const overlayRef = useRef(showOverlay);
  overlayRef.current = showOverlay;
  const freeRamRef = useRef(freeRamOnBoost);
  freeRamRef.current = freeRamOnBoost;
  const updateRef = useRef(update);
  updateRef.current = update;

  const refreshPermissions = useCallback(async () => {
    try {
      setPermissions(await CantosHub.getPermissionStatus());
    } catch {
      // leave previous value; UI shows "unknown"
    }
  }, []);

  const refreshShizuku = useCallback(async () => {
    try {
      setShizuku(await CantosHub.getShizukuStatus());
    } catch {
      setShizuku({ available: false, granted: false });
    }
  }, []);

  const requestShizuku = useCallback(async () => {
    try {
      await CantosHub.requestShizukuPermission();
    } finally {
      await refreshShizuku();
    }
  }, [refreshShizuku]);

  const checkForUpdate = useCallback(async () => {
    try {
      const info = await CantosHub.getVersionInfo();
      const res = await fetch(`${VERSIONS_URL}?t=${Date.now()}`);
      const remote = await res.json();
      if (typeof remote.versionCode === 'number' && remote.versionCode > info.versionCode) {
        setUpdate({
          available: true,
          versionName: remote.versionName,
          apkUrl: remote.apkUrl,
          notes: remote.notes,
        });
      } else {
        setUpdate({ available: false });
      }
    } catch {
      setUpdate(prev => prev ?? { available: false });
    }
  }, []);

  const installUpdate = useCallback(async () => {
    const u = updateRef.current;
    if (u?.apkUrl) await CantosHub.installUpdate(u.apkUrl);
  }, []);

  const dismissWhatsNew = useCallback(() => setWhatsNew(null), []);

  const updateProfile = useCallback(
    (id: string, patch: Partial<BoostProfile>) => {
      setProfiles(prev =>
        prev.map(p => (p.id === id ? { ...p, ...patch } : p)),
      );
    },
    [],
  );

  const addProfile = useCallback((name: string): string => {
    const id = newId();
    setProfiles(prev => [
      ...prev,
      {
        id,
        name: name.trim() || `Profile ${prev.length + 1}`,
        dnd: true,
        peakRefreshRate: true,
        keepAwake: true,
        maxBrightness: false,
      },
    ]);
    setActiveProfileId(id);
    return id;
  }, []);

  const assignGameToProfile = useCallback((profileId: string, packageName: string) => {
    setProfiles(prev =>
      prev.map(p => {
        if (p.id === profileId) return { ...p, packageName };
        if (p.packageName === packageName) return { ...p, packageName: undefined };
        return p;
      }),
    );
  }, []);

  const deleteProfile = useCallback(
    (id: string) => {
      setProfiles(prev => {
        if (prev.length <= 1) return prev; // always keep one
        const next = prev.filter(p => p.id !== id);
        setActiveProfileId(cur => (cur === id ? next[0].id : cur));
        return next;
      });
    },
    [],
  );

  const applyToggleNative = useCallback(
    async (key: ToggleKey, value: boolean) => {
      switch (key) {
        case 'dnd':
          return CantosHub.setDnd(value);
        case 'maxBrightness':
          return CantosHub.setMaxBrightness(value);
        case 'keepAwake':
          return CantosHub.setKeepAwake(value);
        case 'peakRefreshRate':
          return CantosHub.setPeakRefreshRate(value);
      }
    },
    [],
  );

  const startBoost = useCallback(async () => {
    const overlay = overlayRef.current;
    const freeRam = freeRamRef.current;
    if (autoRef.current) {
      // Auto mode: the service watches the foreground game and applies the
      // matching profile (incl. its Shizuku parts) itself.
      await CantosHub.startAutoBoost(profilesRef.current, overlay, freeRam);
    } else {
      const p = activeRef.current;
      await CantosHub.startBoost(p, overlay, freeRam);
      const usesShizuku =
        (p.resolutionScale ?? 1) < 1 || (p.freezeApps?.length ?? 0) > 0;
      if (shizukuRef.current?.granted && usesShizuku) {
        try {
          await CantosHub.applyShizukuProfile(p);
        } catch {
          // best-effort; no-root toggles still applied
        }
      }
    }
    setBoostRunning(true);
  }, []);

  const stopBoost = useCallback(async () => {
    await CantosHub.stopBoost();
    try {
      await CantosHub.revertShizukuProfile();
    } catch {
      // ignore
    }
    setBoostRunning(false);
  }, []);

  const boostGame = useCallback(async (profile: BoostProfile) => {
    setActiveProfileId(profile.id);
    await CantosHub.startBoost(profile, overlayRef.current, freeRamRef.current);
    const usesShizuku =
      (profile.resolutionScale ?? 1) < 1 || (profile.freezeApps?.length ?? 0) > 0;
    if (shizukuRef.current?.granted && usesShizuku) {
      try {
        await CantosHub.applyShizukuProfile(profile);
      } catch {
        // best-effort
      }
    }
    setBoostRunning(true);
  }, []);

  const toggle = useCallback(
    async (key: ToggleKey, value: boolean) => {
      updateProfile(activeRef.current.id, { [key]: value });
      if (boostRunning) {
        try {
          await applyToggleNative(key, value);
        } catch {
          // surfaced by the next telemetry/permission refresh
        }
      }
    },
    [applyToggleNative, boostRunning, updateProfile],
  );

  // On launch, undo anything left applied if the app was killed mid-boost,
  // and prime permission/Shizuku status.
  useEffect(() => {
    CantosHub.reconcile().catch(() => {});
    refreshPermissions();
    refreshShizuku();
    checkForUpdate();
  }, [refreshPermissions, refreshShizuku, checkForUpdate]);

  // Re-check permissions/Shizuku whenever the app comes back to the foreground —
  // e.g. right after the user grants a permission in system Settings.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        refreshPermissions();
        refreshShizuku();
      }
    });
    return () => sub.remove();
  }, [refreshPermissions, refreshShizuku]);

  // After an update installs, show "What's new" once for the new version.
  useEffect(() => {
    (async () => {
      try {
        const info = await CantosHub.getVersionInfo();
        const raw = await AsyncStorage.getItem(LAST_SEEN_KEY);
        const lastSeen = raw ? parseInt(raw, 10) : null;
        if (lastSeen != null && info.versionCode > lastSeen && CHANGELOG[info.versionName]) {
          setWhatsNew({ versionName: info.versionName, notes: CHANGELOG[info.versionName] });
        }
        await AsyncStorage.setItem(LAST_SEEN_KEY, String(info.versionCode));
      } catch {
        // ignore
      }
    })();
  }, []);

  // Hydrate persisted profiles + settings once.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then(raw => {
        if (cancelled || !raw) return;
        const saved = JSON.parse(raw) as Partial<{
          profiles: BoostProfile[];
          activeProfileId: string;
          autoMode: boolean;
          showOverlay: boolean;
          freeRamOnBoost: boolean;
        }>;
        if (Array.isArray(saved.profiles) && saved.profiles.length > 0) {
          setProfiles(saved.profiles);
          const ids = saved.profiles.map(p => p.id);
          setActiveProfileId(
            saved.activeProfileId && ids.includes(saved.activeProfileId)
              ? saved.activeProfileId
              : saved.profiles[0].id,
          );
        }
        if (typeof saved.autoMode === 'boolean') setAutoMode(saved.autoMode);
        if (typeof saved.showOverlay === 'boolean') setShowOverlay(saved.showOverlay);
        if (typeof saved.freeRamOnBoost === 'boolean') setFreeRamOnBoost(saved.freeRamOnBoost);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on change (only after hydration, so we don't clobber saved state).
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ profiles, activeProfileId, autoMode, showOverlay, freeRamOnBoost }),
    ).catch(() => {});
  }, [hydrated, profiles, activeProfileId, autoMode, showOverlay, freeRamOnBoost]);

  const value: Store = {
    profiles,
    activeProfileId,
    activeProfile,
    setActiveProfileId,
    updateProfile,
    addProfile,
    deleteProfile,
    assignGameToProfile,
    permissions,
    refreshPermissions,
    shizuku,
    refreshShizuku,
    requestShizuku,
    autoMode,
    setAutoMode,
    showOverlay,
    setShowOverlay,
    freeRamOnBoost,
    setFreeRamOnBoost,
    update,
    checkForUpdate,
    installUpdate,
    whatsNew,
    dismissWhatsNew,
    boostRunning,
    startBoost,
    stopBoost,
    boostGame,
    toggle,
  };

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

/** True if the permission backing a toggle is granted (or unknown → optimistic). */
export function isToggleUnlocked(
  key: ToggleKey,
  permissions: PermissionStatus | null,
): boolean {
  if (!permissions) return true;
  return permissions[TOGGLE_PERMISSION[key]];
}
