/**
 * Lightweight global store (React context) shared across screens:
 * profiles, the active profile, granted permissions, and boost on/off state.
 *
 * Phase 0 keeps profiles in memory. Persisting them (AsyncStorage) is a tiny
 * follow-up — left out here to keep the scaffold dependency-free.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  BoostProfile,
  CantosHub,
  PermissionStatus,
  ShizukuStatus,
  TOGGLE_PERMISSION,
} from '../native/CantosHub';

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
  return `profile_${idCounter}_${DEFAULT_PROFILES.length}`;
}

type Store = {
  profiles: BoostProfile[];
  activeProfileId: string;
  activeProfile: BoostProfile;
  setActiveProfileId: (id: string) => void;
  updateProfile: (id: string, patch: Partial<BoostProfile>) => void;
  addProfile: (name: string) => void;
  deleteProfile: (id: string) => void;

  permissions: PermissionStatus | null;
  refreshPermissions: () => Promise<void>;

  shizuku: ShizukuStatus | null;
  refreshShizuku: () => Promise<void>;
  requestShizuku: () => Promise<void>;

  boostRunning: boolean;
  startBoost: () => Promise<void>;
  stopBoost: () => Promise<void>;
  /** Flip one toggle on the active profile; applies live if boost is running. */
  toggle: (key: ToggleKey, value: boolean) => Promise<void>;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<BoostProfile[]>(DEFAULT_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState<string>('balanced');
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [shizuku, setShizuku] = useState<ShizukuStatus | null>(null);
  const [boostRunning, setBoostRunning] = useState(false);

  const activeProfile = useMemo(
    () => profiles.find(p => p.id === activeProfileId) ?? profiles[0],
    [profiles, activeProfileId],
  );
  const activeRef = useRef(activeProfile);
  activeRef.current = activeProfile;
  const shizukuRef = useRef(shizuku);
  shizukuRef.current = shizuku;

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

  const updateProfile = useCallback(
    (id: string, patch: Partial<BoostProfile>) => {
      setProfiles(prev =>
        prev.map(p => (p.id === id ? { ...p, ...patch } : p)),
      );
    },
    [],
  );

  const addProfile = useCallback((name: string) => {
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
    const p = activeRef.current;
    await CantosHub.startBoost(p);
    const usesShizuku =
      (p.resolutionScale ?? 1) < 1 || (p.freezeApps?.length ?? 0) > 0;
    if (shizukuRef.current?.granted && usesShizuku) {
      try {
        await CantosHub.applyShizukuProfile(p);
      } catch {
        // best-effort; no-root toggles still applied
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

  const value: Store = {
    profiles,
    activeProfileId,
    activeProfile,
    setActiveProfileId,
    updateProfile,
    addProfile,
    deleteProfile,
    permissions,
    refreshPermissions,
    shizuku,
    refreshShizuku,
    requestShizuku,
    boostRunning,
    startBoost,
    stopBoost,
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
