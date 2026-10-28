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
import { AppState, DeviceEventEmitter } from 'react-native';
import { CHANGELOG } from '../changelog';
import {
  BoostProfile,
  BoostState,
  Capabilities,
  CantosHub,
  InstallResult,
  KidsConfig,
  GameBoosterStatus,
  PermissionStatus,
  ShizukuStatus,
  TOGGLE_PERMISSION,
} from '../native/CantosHub';

const STORAGE_KEY = 'cantoshub_state_v1';
/** Last save that loaded fine; used if the main save is ever missing or damaged. */
const BACKUP_KEY = 'cantoshub_state_v1_backup';
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

export type Folder = {
  id: string;
  name: string;
  packages: string[];
};

export type HiddenGame = {
  packageName: string;
  label: string;
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
  /** Take the game off whichever profile it is bound to (no profile assigned). */
  unassignGame: (packageName: string) => void;

  folders: Folder[];
  addFolder: (name: string) => string;
  deleteFolder: (id: string) => void;
  toggleGameInFolder: (folderId: string, packageName: string) => void;

  hiddenGames: HiddenGame[];
  hideGame: (game: HiddenGame) => Promise<boolean>;
  unhideGame: (packageName: string) => Promise<boolean>;
  /** Drop "hidden" records for games that are visible again (re-enabled outside CantosHub). */
  forgetHidden: (packageNames: string[]) => void;

  /** Apps the user added to Games (Android doesn't tag them as games). */
  addedGames: HiddenGame[];
  addGames: (apps: HiddenGame[]) => void;
  removeAddedGame: (packageName: string) => void;
  /** Saved state has loaded. */
  hydrated: boolean;

  permissions: PermissionStatus | null;
  refreshPermissions: () => Promise<void>;

  shizuku: ShizukuStatus | null;
  refreshShizuku: () => Promise<void>;
  requestShizuku: () => Promise<void>;

  gameBooster: GameBoosterStatus | null;
  refreshGameBooster: () => Promise<void>;
  blockGameBooster: (blocked: boolean) => Promise<boolean>;

  autoMode: boolean;
  setAutoMode: (v: boolean) => void;
  showOverlay: boolean;
  setShowOverlay: (v: boolean) => void;
  freeRamOnBoost: boolean;
  setFreeRamOnBoost: (v: boolean) => void;

  update: UpdateState | null;
  checkForUpdate: () => Promise<void>;
  /** Download + install the update; resolves what happened (null: no update to install). */
  installUpdate: () => Promise<InstallResult | null>;

  whatsNew: WhatsNew | null;
  dismissWhatsNew: () => void;

  boostRunning: boolean;
  /** What the boost service is doing (mode, profile / game in use); null until first read. */
  boostState: BoostState | null;
  /** Re-read whether the boost service is actually running (e.g. stopped from the notification). */
  syncBoost: () => Promise<void>;
  capabilities: Capabilities | null;
  kids: KidsConfig | null;
  refreshKids: () => Promise<void>;
  startBoost: () => Promise<void>;
  stopBoost: () => Promise<void>;
  /**
   * Boost & Play: a manual boost with [profile] - or, in Auto mode, just make sure Auto is
   * running (it picks the game's profile itself; a manual boost would replace Auto).
   */
  boostGame: (profile: BoostProfile) => Promise<void>;
  /**
   * Flip one toggle on a profile (the active one by default). A running boost picks the edit
   * up through updateAutoProfiles - only the service knows if it's really still running.
   */
  toggle: (key: ToggleKey, value: boolean, profileId?: string) => Promise<void>;
};

const StoreContext = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [profiles, setProfiles] = useState<BoostProfile[]>(DEFAULT_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState<string>('balanced');
  const [permissions, setPermissions] = useState<PermissionStatus | null>(null);
  const [shizuku, setShizuku] = useState<ShizukuStatus | null>(null);
  const [gameBooster, setGameBooster] = useState<GameBoosterStatus | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [showOverlay, setShowOverlay] = useState(false);
  const [freeRamOnBoost, setFreeRamOnBoost] = useState(true);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [hiddenGames, setHiddenGames] = useState<HiddenGame[]>([]);
  const [addedGames, setAddedGames] = useState<HiddenGame[]>([]);
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [whatsNew, setWhatsNew] = useState<WhatsNew | null>(null);
  const [boostRunning, setBoostRunning] = useState(false);
  const [boostState, setBoostState] = useState<BoostState | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [kids, setKids] = useState<KidsConfig | null>(null);
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
  const runningRef = useRef(boostRunning);
  runningRef.current = boostRunning;
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

  // The built-in connection came or went (paired, reconnected after a restart, Wi-Fi lost).
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('CantosHubShellChanged', () => {
      refreshShizuku();
    });
    return () => sub.remove();
  }, [refreshShizuku]);

  const requestShizuku = useCallback(async () => {
    try {
      await CantosHub.requestShizukuPermission();
    } finally {
      await refreshShizuku();
    }
  }, [refreshShizuku]);

  const refreshGameBooster = useCallback(async () => {
    try {
      setGameBooster(await CantosHub.getGameBoosterStatus());
    } catch {
      setGameBooster({ present: false, blocked: false, components: [] });
    }
  }, []);

  const blockGameBooster = useCallback(
    async (blocked: boolean): Promise<boolean> => {
      const ok = await CantosHub.setGameBoosterBlocked(blocked);
      await refreshGameBooster();
      return ok;
    },
    [refreshGameBooster],
  );

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

  const installUpdate = useCallback(async (): Promise<InstallResult | null> => {
    const u = updateRef.current;
    return u?.apkUrl ? CantosHub.installUpdate(u.apkUrl) : null;
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

  const unassignGame = useCallback((packageName: string) => {
    setProfiles(prev => prev.map(p => (p.packageName === packageName ? { ...p, packageName: undefined } : p)));
  }, []);

  const addFolder = useCallback((name: string): string => {
    const id = `folder_${Date.now()}`;
    setFolders(prev => [
      ...prev,
      { id, name: name.trim() || `Folder ${prev.length + 1}`, packages: [] },
    ]);
    return id;
  }, []);

  const deleteFolder = useCallback((id: string) => {
    setFolders(prev => prev.filter(f => f.id !== id));
  }, []);

  const toggleGameInFolder = useCallback((folderId: string, packageName: string) => {
    setFolders(prev =>
      prev.map(f => {
        if (f.id !== folderId) return f;
        const has = f.packages.includes(packageName);
        return {
          ...f,
          packages: has
            ? f.packages.filter(p => p !== packageName)
            : [...f.packages, packageName],
        };
      }),
    );
  }, []);

  const hideGame = useCallback(async (game: HiddenGame): Promise<boolean> => {
    const ok = await CantosHub.hideApp(game.packageName);
    if (ok) {
      setHiddenGames(prev =>
        prev.some(h => h.packageName === game.packageName)
          ? prev
          : [...prev, { packageName: game.packageName, label: game.label }],
      );
    }
    return ok;
  }, []);

  const addGames = useCallback((apps: HiddenGame[]) => {
    setAddedGames(prev => [
      ...prev,
      ...apps
        .filter(a => !prev.some(p => p.packageName === a.packageName))
        .map(a => ({ packageName: a.packageName, label: a.label })),
    ]);
  }, []);

  const removeAddedGame = useCallback((packageName: string) => {
    setAddedGames(prev => prev.filter(a => a.packageName !== packageName));
  }, []);

  const forgetHidden = useCallback((packageNames: string[]) => {
    if (!packageNames.length) return;
    setHiddenGames(prev => prev.filter(h => !packageNames.includes(h.packageName)));
  }, []);

  const unhideGame = useCallback(async (packageName: string): Promise<boolean> => {
    const ok = await CantosHub.unhideApp(packageName);
    if (ok) setHiddenGames(prev => prev.filter(h => h.packageName !== packageName));
    return ok;
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

  const startBoost = useCallback(async () => {
    const overlay = overlayRef.current;
    const freeRam = freeRamRef.current;
    if (autoRef.current) {
      // Auto mode: the service watches the foreground game and applies the
      // matching profile (incl. its Shizuku parts) itself.
      await CantosHub.startAutoBoost(profilesRef.current, overlay, freeRam);
    } else {
      // The service applies the no-root toggles and, with Shizuku, the Pro parts.
      await CantosHub.startBoost(activeRef.current, overlay, freeRam);
    }
    setBoostRunning(true);
    setBoostState({ running: true, auto: autoRef.current, profileId: autoRef.current ? null : activeRef.current.id, game: null });
  }, []);

  const stopBoost = useCallback(async () => {
    await CantosHub.stopBoost(); // the service reverts everything, incl. Shizuku parts
    setBoostRunning(false);
    setBoostState({ running: false, auto: false, profileId: null, game: null });
  }, []);

  const refreshKids = useCallback(async () => {
    try {
      setKids(await CantosHub.kidsGetConfig());
    } catch {
      // keep current value
    }
  }, []);

  const syncBoost = useCallback(async () => {
    try {
      const s = await CantosHub.getBoostState();
      setBoostRunning(s.running);
      setBoostState(prev =>
        prev && prev.running === s.running && prev.auto === s.auto && prev.profileId === s.profileId && prev.game === s.game
          ? prev
          : s,
      );
    } catch {
      // keep current value
    }
  }, []);

  const boostGame = useCallback(async (profile: BoostProfile) => {
    if (autoRef.current) {
      // Library Play used to start a manual boost here, quietly ending Auto while the app
      // still said Auto.
      if (!runningRef.current) await startBoost();
      return;
    }
    setActiveProfileId(profile.id);
    await CantosHub.startBoost(profile, overlayRef.current, freeRamRef.current);
    setBoostRunning(true);
    setBoostState({ running: true, auto: false, profileId: profile.id, game: null });
  }, [startBoost]);

  const toggle = useCallback(
    async (key: ToggleKey, value: boolean, profileId?: string) => {
      // No direct settings write: after a Stop from the notification or tile the app still
      // thought it was boosting, and wrote DND / timeout with nothing left to restore them.
      updateProfile(profileId ?? activeRef.current.id, { [key]: value });
    },
    [updateProfile],
  );

  // On launch, undo anything left applied if the app was killed mid-boost,
  // and prime permission/Shizuku status.
  useEffect(() => {
    // Sync with the real service first; reconcile only undoes leftovers when it isn't running.
    CantosHub.isBoostRunning()
      .then(setBoostRunning)
      .catch(() => {})
      .finally(() => CantosHub.reconcile().catch(() => {}));
    CantosHub.getCapabilities().then(setCapabilities).catch(() => {});
    refreshKids();
    refreshPermissions();
    refreshShizuku();
    refreshGameBooster();
    checkForUpdate();
  }, [refreshPermissions, refreshShizuku, refreshGameBooster, checkForUpdate, refreshKids]);

  // Re-check permissions/Shizuku/booster whenever the app comes back to the
  // foreground — e.g. right after the user grants a permission in system Settings.
  useEffect(() => {
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        syncBoost();
        refreshKids();
        refreshPermissions();
        refreshShizuku();
        refreshGameBooster();
      }
    });
    return () => sub.remove();
  }, [refreshPermissions, refreshShizuku, refreshGameBooster, syncBoost, refreshKids]);

  // Profile edits reach a running boost right away, Auto or Manual (no stop/start needed).
  useEffect(() => {
    if (!hydrated || !boostRunning) return;
    const t = setTimeout(() => {
      CantosHub.updateAutoProfiles(profiles).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [hydrated, boostRunning, profiles]);

  // Home-screen shortcuts and the Quick tile read these natively when tapped.
  useEffect(() => {
    if (!hydrated) return;
    const t = setTimeout(() => {
      CantosHub.syncBoostSettings({
        profiles,
        activeId: activeProfileId,
        auto: autoMode,
        overlay: showOverlay,
        freeRam: freeRamOnBoost,
      }).catch(() => {});
    }, 300);
    return () => clearTimeout(t);
  }, [hydrated, profiles, activeProfileId, autoMode, showOverlay, freeRamOnBoost]);

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
  //
  // NEVER SAVE OVER DATA WE COULD NOT READ. This used to swallow a failed read (or a damaged
  // save) and mark the store hydrated anyway, so the very next save wrote the empty defaults
  // over the user's folders, game bindings and hidden/added games. Now: a read that keeps
  // failing leaves saving switched off for this session; a save that won't parse is kept
  // aside and the last good copy (BACKUP_KEY, refreshed on every good load) is used instead.
  useEffect(() => {
    let cancelled = false;
    const readWithRetry = async (key: string): Promise<string | null> => {
      for (let i = 0; i < 3; i++) {
        try {
          return await AsyncStorage.getItem(key);
        } catch {
          await new Promise<void>(r => setTimeout(() => r(), 300 * (i + 1)));
        }
      }
      throw new Error('storage unreadable');
    };
    const apply = (saved: Partial<{
      profiles: BoostProfile[];
      activeProfileId: string;
      autoMode: boolean;
      showOverlay: boolean;
      freeRamOnBoost: boolean;
      folders: Folder[];
      hiddenGames: HiddenGame[];
      addedGames: HiddenGame[];
    }>) => {
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
      if (Array.isArray(saved.folders)) setFolders(saved.folders);
      if (Array.isArray(saved.hiddenGames)) setHiddenGames(saved.hiddenGames);
      if (Array.isArray(saved.addedGames)) setAddedGames(saved.addedGames);
    };
    (async () => {
      let raw: string | null;
      try {
        raw = await readWithRetry(STORAGE_KEY);
      } catch {
        return;                       // unreadable: keep saving OFF so nothing is overwritten
      }
      if (cancelled) return;
      let parsed: any = null;
      if (raw) {
        try {
          parsed = JSON.parse(raw);
        } catch {
          AsyncStorage.setItem(`${STORAGE_KEY}_damaged_${Date.now()}`, raw).catch(() => {});
        }
      }
      if (!parsed) {
        // Missing or damaged: fall back to the last good copy, if there is one.
        const backup = await AsyncStorage.getItem(BACKUP_KEY).catch(() => null);
        if (backup) {
          try { parsed = JSON.parse(backup); } catch { parsed = null; }
        }
      } else if (raw) {
        AsyncStorage.setItem(BACKUP_KEY, raw).catch(() => {});
      }
      if (cancelled) return;
      if (parsed) apply(parsed);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on change (only after hydration, so we don't clobber saved state).
  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        profiles,
        activeProfileId,
        autoMode,
        showOverlay,
        freeRamOnBoost,
        folders,
        hiddenGames,
        addedGames,
      }),
    ).catch(() => {});
  }, [
    hydrated,
    profiles,
    activeProfileId,
    autoMode,
    showOverlay,
    freeRamOnBoost,
    folders,
    hiddenGames,
    addedGames,
  ]);

  const value: Store = {
    profiles,
    activeProfileId,
    activeProfile,
    setActiveProfileId,
    updateProfile,
    addProfile,
    deleteProfile,
    assignGameToProfile,
    unassignGame,
    folders,
    addFolder,
    deleteFolder,
    toggleGameInFolder,
    hiddenGames,
    hideGame,
    unhideGame,
    forgetHidden,
    addedGames,
    addGames,
    removeAddedGame,
    hydrated,
    permissions,
    refreshPermissions,
    shizuku,
    refreshShizuku,
    requestShizuku,
    gameBooster,
    refreshGameBooster,
    blockGameBooster,
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
    boostState,
    syncBoost,
    capabilities,
    kids,
    refreshKids,
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
