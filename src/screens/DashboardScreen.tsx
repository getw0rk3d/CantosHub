/** Main boost dashboard: master switch, quick toggles, live telemetry. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  DeviceEventEmitter,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  PrimaryButton,
  SectionCard,
  ToggleRow,
} from '../components/ui';
import { AppIcon } from '../components/AppIcon';
import { Icon } from '../components/Icon';
import { CantosHub, GameInfo, Telemetry } from '../native/CantosHub';
import { isToggleUnlocked, ToggleKey, useStore } from '../state/store';
import { colors, spacing, thermalLabel } from '../theme';

function gb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(1);
}

const TOGGLES: { key: ToggleKey; label: string; desc: string }[] = [
  { key: 'dnd', label: 'Do Not Disturb', desc: 'Silence calls & notifications while gaming' },
  { key: 'peakRefreshRate', label: 'Peak refresh rate', desc: 'Request the highest Hz your screen supports' },
  { key: 'keepAwake', label: 'Keep screen awake', desc: 'Stop the display sleeping mid-match' },
  { key: 'maxBrightness', label: 'Max brightness', desc: 'Lock brightness high for visibility' },
];

export default function DashboardScreen({
  onGoPermissions,
  onGoGames,
}: {
  onGoPermissions: () => void;
  onGoGames: () => void;
}) {
  const store = useStore();
  const { activeProfile, boostRunning, boostState, permissions, autoMode, showOverlay } = store;
  // While boosting, show what's really running: the manual boost's profile (Set active in
  // Profiles doesn't switch it), or in Auto the profile of the game being boosted.
  const runningProfile =
    boostState?.running && !boostState.auto && boostState.profileId
      ? store.profiles.find(p => p.id === boostState.profileId)
      : undefined;
  const autoGameProfile =
    boostState?.running && boostState.auto && boostState.game
      ? store.profiles.find(p => p.packageName === boostState.game)
      : undefined;
  const shownProfile = (boostRunning && runningProfile) || activeProfile;
  // Quick toggles edit the profile that's in use. In Auto that's each game's own profile, so
  // there's nothing to show until a game is being boosted.
  const toggleProfile = autoMode ? autoGameProfile : shownProfile;
  // Android 14+ only lets shell close other apps (killBackgroundProcesses does nothing there).
  const freeRamNeedsPro = Platform.OS === 'android' && Number(Platform.Version) >= 34 && !store.shizuku?.granted;
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [dlProgress, setDlProgress] = useState(0);
  const [cleaning, setCleaning] = useState<null | 'ram' | 'cache'>(null);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);
  const [boosterMsg, setBoosterMsg] = useState<string | null>(null);
  const mounted = useRef(true);
  const [games, setGames] = useState<GameInfo[]>([]);

  const addedKey = store.addedGames.map(a => a.packageName).join(',');
  useEffect(() => {
    CantosHub.listGames(addedKey ? addedKey.split(',') : [])
      .then(list => mounted.current && setGames(list))
      .catch(() => {});
  }, [addedKey]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('CantosHubUpdateProgress', (pct: number) =>
      setDlProgress(pct),
    );
    return () => sub.remove();
  }, []);

  const onInstall = useCallback(async () => {
    setInstalling(true);
    setDlProgress(0);
    try {
      const r = await store.installUpdate();
      // Sent to "Install unknown apps" first (or nothing to do): tap again after allowing it.
      if (r !== 'INSTALLING' && r !== 'BUSY') setInstalling(false);
    } catch {
      setInstalling(false);
      Alert.alert('Update failed', 'The download didn’t finish. Check your connection and tap the banner to try again.');
    }
  }, [store]);

  // Back from the installer (cancelled) or the permission page: the banner is tappable again.
  useEffect(() => {
    if (!installing) return;
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active' && dlProgress >= 100) setInstalling(false);
    });
    return () => sub.remove();
  }, [installing, dlProgress]);

  const loadTelemetry = useCallback(async () => {
    // Don't poll native telemetry while CantosHub is backgrounded (e.g. a game is
    // in the foreground) — RN doesn't reliably pause app-level timers, and the
    // foreground service keeps this JS runtime alive during a boost.
    if (AppState.currentState !== 'active') return;
    const t = await CantosHub.getTelemetry();
    if (mounted.current) setTelemetry(t);
    // Also catch a Stop from the notification or Quick tile while CantosHub is open (pulling
    // down the shade doesn't pause the app, so nothing else notices), and leftovers undone.
    store.syncBoost();
    CantosHub.getProLeftovers().then(l => mounted.current && setLeftovers(l)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PRO changes still in place with no Shizuku to undo them (it died mid-boost: a restart,
  // Wi-Fi off). CantosHub retries on its own once Shizuku is back; until then say so.
  const [leftovers, setLeftovers] = useState<{ frozenApps: number; resolutionChanged: boolean } | null>(null);
  useEffect(() => {
    CantosHub.getProLeftovers().then(l => mounted.current && setLeftovers(l)).catch(() => {});
  }, [boostRunning, store.shizuku?.granted]);

  useEffect(() => {
    mounted.current = true;
    store.refreshPermissions();
    store.refreshShizuku();
    loadTelemetry();
    // Only read the service state — re-starting a running boost here used to re-run
    // Free RAM / Shizuku and reset Auto mode every time this tab was opened.
    store.syncBoost();
    const id = setInterval(loadTelemetry, 2000);
    return () => {
      mounted.current = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onMaster = useCallback(async () => {
    setBusy(true);
    try {
      if (boostRunning) await store.stopBoost();
      else await store.startBoost();
    } finally {
      setBusy(false);
    }
  }, [boostRunning, store]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([store.refreshPermissions(), loadTelemetry()]);
    setRefreshing(false);
  }, [loadTelemetry, store]);

  const onFreeRam = useCallback(async () => {
    setCleaning('ram');
    setCleanMsg(null);
    try {
      const r = await CantosHub.freeRam();
      const freedMb = Math.round(r.freedBytes / 1048576);
      const freeGb = (r.availMem / 1073741824).toFixed(1);
      setCleanMsg(
        r.targeted < 0
          ? `Android 14 and newer only let CantosHub close other apps through Shizuku (PRO). ${freeGb} GB free right now.`
          : freedMb > 0
          ? `Closed ${r.targeted} background apps · freed ~${freedMb} MB · ${freeGb} GB free`
          : `Closed ${r.targeted} background apps · ${freeGb} GB free`,
      );
    } catch {
      setCleanMsg('Could not free RAM.');
    } finally {
      setCleaning(null);
      loadTelemetry();
    }
  }, [loadTelemetry]);

  const onClearCache = useCallback(async () => {
    setCleaning('cache');
    setCleanMsg(null);
    try {
      const r = await CantosHub.clearCaches();
      const own = (r.ownFreedBytes / 1048576).toFixed(1);
      setCleanMsg(
        r.systemTrim
          ? `System-wide cache trimmed (Shizuku) · app cache ${own} MB`
          : `App cache cleared (${own} MB). Clearing every app’s cache at once is PRO (needs Shizuku).`,
      );
    } catch {
      setCleanMsg('Could not clear cache.');
    } finally {
      setCleaning(null);
    }
  }, []);

  // Blocked earlier with Shizuku, now locked: each blocked part has an Enable button in its
  // App info page, so walk through those instead of leaving Samsung's booster stuck off.
  const onBoosterLocked = useCallback(async () => {
    if (!store.gameBooster?.blocked) { onGoPermissions(); return; }
    const pkgs = await CantosHub.blockedBoosterPackages();
    if (!pkgs.length) { store.refreshGameBooster(); return; }
    const openNext = (i: number) => {
      if (i >= pkgs.length) { store.refreshGameBooster(); return; }
      Alert.alert(
        `Turn Samsung's booster back on (${i + 1} of ${pkgs.length})`,
        'Without Shizuku CantosHub can’t switch it back itself. On the next screen tap Enable, then come back here.',
        [
          { text: 'Not now', style: 'cancel' },
          {
            text: 'Open',
            onPress: async () => {
              await CantosHub.openAppInfo(pkgs[i]);
              const sub = AppState.addEventListener('change', s => {
                if (s !== 'active') return;
                sub.remove();
                openNext(i + 1);
              });
            },
          },
        ],
      );
    };
    openNext(0);
  }, [store, onGoPermissions]);

  const onToggleBooster = useCallback(
    async (v: boolean) => {
      setBoosterMsg(null);
      const ok = await store.blockGameBooster(v);
      if (!ok) {
        setBoosterMsg('Needs Shizuku to change this.');
      } else {
        setBoosterMsg(
          v
            ? 'Samsung Game Booster blocked — CantosHub is in charge.'
            : 'Samsung Game Booster restored.',
        );
      }
    },
    [store],
  );

  const therm = thermalLabel(telemetry?.thermalStatus ?? -1);
  const usedMem = telemetry ? telemetry.totalMem - telemetry.availMem : 0;

  // Bound games first, then most-played — the quick-launch row (max 4).
  const bound = store.profiles.filter(p => p.packageName);
  const byPkg = new Map(games.map(g => [g.packageName, g]));
  const quick: { pkg: string; label: string }[] = [];
  for (const p of bound) {
    const g = byPkg.get(p.packageName as string);
    if (g && quick.length < 4 && !quick.some(q => q.pkg === g.packageName)) {
      quick.push({ pkg: g.packageName, label: g.label });
    }
  }
  for (const g of [...games].sort((x, y) => y.totalTimeMs - x.totalTimeMs)) {
    if (quick.length >= 4) break;
    if (!quick.some(q => q.pkg === g.packageName)) quick.push({ pkg: g.packageName, label: g.label });
  }
  const freeGb = telemetry ? gb(telemetry.availMem) : '—';

  const playGame = async (pkg: string) => {
    const profile = store.profiles.find(p => p.packageName === pkg);
    if (profile && !autoMode) await store.boostGame(profile);
    else if (autoMode && !boostRunning) await store.startBoost();
    await CantosHub.launchApp(pkg);
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>CantosHub</Text>
          <Text style={styles.subtitle}>
            {autoMode ? 'Auto mode' : `Manual · ${activeProfile.name}`} · {bound.length} game
            {bound.length === 1 ? '' : 's'} bound
          </Text>
        </View>
        <View style={[styles.statusChip, boostRunning && styles.statusChipOn]}>
          <View style={[styles.statusDot, boostRunning && styles.statusDotOn]} />
          <Text style={[styles.statusText, boostRunning && styles.statusTextOn]}>
            {boostRunning ? 'Boosting' : 'Idle'}
          </Text>
        </View>
      </View>

      {store.update?.available && (
        <Pressable style={styles.update} onPress={onInstall} disabled={installing}>
          <Text style={styles.updateTitle}>
            {installing
              ? `Downloading update… ${dlProgress}%`
              : `Update available — v${store.update.versionName}`}
          </Text>
          {!installing && !!store.update.notes && (
            <Text style={styles.updateNotes}>{store.update.notes}</Text>
          )}
          {!installing && <Text style={styles.updateCta}>Tap to install</Text>}
        </Pressable>
      )}

      {!CantosHub.isNativeAvailable && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Native module not built yet — showing demo data. Run an Android build to go live.
          </Text>
        </View>
      )}

      {/* Round boost button */}
      <View style={styles.ringWrap}>
        <View style={[styles.halo, boostRunning && styles.haloOn]}>
          <Pressable
            onPress={onMaster}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={boostRunning ? 'Stop boost' : 'Start boost'}
            android_ripple={{ color: 'rgba(0,229,160,0.2)', borderless: true, radius: 96 }}
            style={[styles.ring, boostRunning && styles.ringOn, busy && styles.masterBusy]}>
            <Icon
              name="bolt"
              size={40}
              color={boostRunning ? colors.accent : colors.textDim}
              fill={boostRunning ? colors.accent : 'none'}
            />
            <Text style={[styles.ringTitle, boostRunning && styles.ringTitleOn]}>
              {busy ? 'Working…' : boostRunning ? (autoMode ? 'Auto boost on' : 'Boost on') : autoMode ? 'Start auto' : 'Start boost'}
            </Text>
            <Text style={styles.ringSub} numberOfLines={1}>
              {boostRunning
                ? autoMode
                  ? autoGameProfile?.name ?? 'Watching for games'
                  : shownProfile.name
                : autoMode
                ? 'Applies per game'
                : activeProfile.name}
            </Text>
          </Pressable>
        </View>
      </View>
      <Text style={styles.ringHint}>{boostRunning ? 'Tap to stop' : 'Tap to start'}</Text>

      {/* Stat tiles */}
      <View style={styles.tiles}>
        <Tile label="Battery" value={telemetry ? String(telemetry.batteryLevel) : '—'} unit="%" />
        <Tile label="Temp" value={therm.label === 'None' || therm.label === 'Light' ? 'Cool' : therm.label} color={therm.color} />
        <Tile
          label="RAM"
          value={telemetry ? gb(usedMem) : '—'}
          unit={telemetry ? `/${Math.round(telemetry.totalMem / 1073741824)}` : undefined}
        />
        <Tile label="Free" value={freeGb} unit="GB" color={colors.accent2} />
      </View>
      {telemetry?.lowMemory && <Text style={styles.warnLine}>⚠️ System reports low memory</Text>}

      {/* Your games */}
      <View style={styles.gamesHead}>
        <Text style={styles.gamesTitle}>Your games</Text>
        <Pressable onPress={onGoGames} hitSlop={8}>
          <Text style={styles.link}>See all</Text>
        </Pressable>
      </View>
      <View style={styles.gamesRow}>
        {quick.map(q => {
          const isBound = bound.some(p => p.packageName === q.pkg);
          return (
            <Pressable key={q.pkg} style={styles.gameItem} onPress={() => playGame(q.pkg)}>
              <View style={[styles.gameIconWrap, isBound && styles.gameIconBound]}>
                <AppIcon packageName={q.pkg} label={q.label} size={54} />
              </View>
              <Text style={styles.gameName} numberOfLines={1}>
                {q.label}
              </Text>
            </Pressable>
          );
        })}
        {quick.length < 4 && (
          <Pressable style={styles.gameItem} onPress={onGoGames}>
            <View style={styles.addTile}>
              <Icon name="plus" size={22} color={colors.textDim} />
            </View>
            <Text style={styles.gameName}>Add</Text>
          </Pressable>
        )}
      </View>

      {/* Mode */}
      <SectionCard title="Mode">
        <ToggleRow
          label="Auto by game"
          description="Apply each profile automatically when its game opens"
          value={autoMode}
          onValueChange={store.setAutoMode}
          locked={!!permissions && !permissions.usageAccess}
          lockedHint="Needs Usage access"
          onPressLocked={onGoPermissions}
        />
        <ToggleRow
          label="Show overlay HUD"
          description={store.shizuku?.granted ? "FPS · battery · thermal · RAM on top of your game" : "Battery · thermal · RAM on top of your game (live FPS is PRO: needs Shizuku)"}
          value={showOverlay}
          onValueChange={store.setShowOverlay}
          locked={!!permissions && !permissions.overlay}
          lockedHint="Needs Display-over-apps"
          onPressLocked={onGoPermissions}
        />
        {boostRunning && (
          <Text style={styles.modeHint}>Stop & start a boost to apply mode changes.</Text>
        )}
      </SectionCard>

      {/* PRO changes still in place that only Shizuku can undo */}
      {!boostRunning && !!leftovers && (leftovers.frozenApps > 0 || leftovers.resolutionChanged) && (
        <SectionCard title="Still active from a boost">
          <Text style={styles.freeDesc}>
            {[
              leftovers.frozenApps > 0 ? `${leftovers.frozenApps} app${leftovers.frozenApps === 1 ? ' is' : 's are'} still frozen` : null,
              leftovers.resolutionChanged ? 'the screen resolution is still lowered' : null,
            ].filter(Boolean).join(' and ')}
            {store.shizuku?.granted
              ? ' — Shizuku is back, putting it all back now…'
              : ' — Shizuku stopped before CantosHub could undo it (for example after a restart). Start Shizuku again and CantosHub puts everything back by itself.'}
          </Text>
          {!store.shizuku?.granted && (
            <View style={styles.freeBtn}>
              <PrimaryButton title="Open Access" variant="outline" onPress={onGoPermissions} />
            </View>
          )}
        </SectionCard>
      )}

      {/* Free up memory */}
      <SectionCard title="Free up">
        <Text style={styles.freeDesc}>
          Kill background apps to give your game more RAM. Android may relaunch them
          later — best used right before you play.
        </Text>
        <View style={styles.freeRow}>
          <View style={styles.freeBtn}>
            <PrimaryButton title="Free RAM" onPress={onFreeRam} busy={cleaning === 'ram'} />
          </View>
          <View style={styles.freeBtn}>
            <PrimaryButton
              title="Clear cache"
              variant="outline"
              onPress={onClearCache}
              busy={cleaning === 'cache'}
            />
          </View>
        </View>
        {!!cleanMsg && <Text style={styles.freeMsg}>{cleanMsg}</Text>}
        <View style={styles.freeDivider} />
        <ToggleRow
          label="Auto-free RAM on boost"
          description={
            freeRamNeedsPro
              ? 'Close background apps when a game launches. On Android 14 and newer this needs Shizuku'
              : 'Close background apps automatically when a game launches'
          }
          value={store.freeRamOnBoost}
          onValueChange={store.setFreeRamOnBoost}
          pro={freeRamNeedsPro}
        />
      </SectionCard>

      {/* Samsung Game Booster (only on Samsung devices) */}
      {store.gameBooster?.present && (
        <SectionCard title="Samsung Game Booster">
          <Text style={styles.freeDesc}>
            Samsung's Game Booster throttles games and pops up its own panel. Block it so
            CantosHub is in charge. Note: this also turns off Samsung's automatic thermal
            management — keep an eye on the thermal readout above.
          </Text>
          {store.gameBooster.components.length > 0 && (
            <Text style={styles.boosterList}>
              Blocks: {store.gameBooster.components.join(' · ')}
            </Text>
          )}
          <ToggleRow
            label="Block Samsung Game Booster"
            description={
              store.gameBooster.blocked
                ? 'Blocked — Samsung booster is off'
                : 'Samsung booster is currently active'
            }
            value={store.gameBooster.blocked}
            onValueChange={onToggleBooster}
            locked={!store.shizuku?.granted}
            lockedHint={store.gameBooster.blocked
              ? 'Needs Shizuku to change. Tap to turn Samsung’s booster back on by hand'
              : 'Needs Shizuku — set it up in Access'}
            onPressLocked={onBoosterLocked}
            pro
          />
          {!!boosterMsg && <Text style={styles.freeMsg}>{boosterMsg}</Text>}
        </SectionCard>
      )}

      {/* Quick toggles */}
      <SectionCard
        title={toggleProfile ? `Quick toggles · ${toggleProfile.name}` : 'Quick toggles'}
        right={
          <Pressable onPress={onGoPermissions}>
            <Text style={styles.link}>Permissions</Text>
          </Pressable>
        }>
        {!toggleProfile ? (
          <Text style={styles.freeDesc}>
            Auto mode: each game uses its own profile. While a game is being boosted, its
            switches show here; edit the others in Profiles.
          </Text>
        ) : (
          TOGGLES.filter(t => t.key !== 'peakRefreshRate' || store.capabilities?.peakRefreshRate !== false).map(t => {
            const unlocked = isToggleUnlocked(t.key, permissions);
            return (
              <ToggleRow
                key={t.key}
                label={t.label}
                description={t.desc}
                value={toggleProfile[t.key]}
                onValueChange={v => store.toggle(t.key, v, toggleProfile.id)}
                locked={!unlocked}
                lockedHint={!unlocked ? 'Tap to grant the required permission' : undefined}
                onPressLocked={onGoPermissions}
              />
            );
          })
        )}
      </SectionCard>

      {store.capabilities?.peakRefreshRate === false && (
        <Text style={styles.footnote}>
          Refresh rate: your phone manages this itself — set Settings › Display › Motion
          smoothness to Adaptive for up to 120 Hz in games.
        </Text>
      )}

      <Text style={styles.footnote}>
        100% no-root. CantosHub only uses permissions you grant — it never modifies the
        system without your say-so.
      </Text>
    </ScrollView>
  );
}

function Tile({ label, value, unit, color }: { label: string; value: string; unit?: string; color?: string }) {
  return (
    <View style={styles.tile}>
      <Text style={styles.tileLabel}>{label}</Text>
      <View style={styles.tileRow}>
        <Text style={[styles.tileValue, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>
          {value}
        </Text>
        {!!unit && <Text style={styles.tileUnit}>{unit}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  headerText: { flex: 1, paddingRight: spacing.md },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.textDim, fontSize: 13, marginTop: 2 },
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusChipOn: { backgroundColor: 'rgba(0,229,160,0.12)', borderColor: 'rgba(0,229,160,0.4)' },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.textDim },
  statusDotOn: { backgroundColor: colors.accent },
  statusText: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  statusTextOn: { color: colors.accent },
  ringWrap: { alignItems: 'center', marginTop: spacing.sm },
  halo: { padding: 10, borderRadius: 999, borderWidth: 1, borderColor: 'transparent' },
  haloOn: { borderColor: 'rgba(0,229,160,0.25)', backgroundColor: 'rgba(0,229,160,0.04)' },
  ring: {
    width: 188,
    height: 188,
    borderRadius: 94,
    borderWidth: 6,
    borderColor: colors.border,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  ringOn: { borderColor: colors.accent, backgroundColor: 'rgba(0,229,160,0.10)' },
  ringTitle: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 6 },
  ringTitleOn: { color: colors.accent },
  ringSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  ringHint: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: spacing.sm, marginBottom: spacing.lg },
  tiles: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  tile: { flex: 1, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 10 },
  tileLabel: { color: colors.textDim, fontSize: 11 },
  tileRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 3 },
  tileValue: { color: colors.text, fontSize: 18, fontWeight: '800', flexShrink: 1 },
  tileUnit: { color: colors.textDim, fontSize: 11, marginLeft: 2, marginBottom: 2 },
  gamesHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.md, marginBottom: spacing.sm },
  gamesTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  gamesRow: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.lg },
  gameItem: { width: 64, alignItems: 'center' },
  gameIconWrap: { borderRadius: 16, borderWidth: 2, borderColor: 'transparent', padding: 1 },
  gameIconBound: { borderColor: colors.accent },
  gameName: { color: colors.text, fontSize: 11, marginTop: 4, textAlign: 'center' },
  addTile: {
    width: 58,
    height: 58,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notice: {
    backgroundColor: 'rgba(255,176,32,0.12)',
    borderColor: colors.warn,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noticeText: { color: colors.warn, fontSize: 12 },
  update: {
    backgroundColor: 'rgba(0,229,160,0.10)',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  updateTitle: { color: colors.accent, fontSize: 14, fontWeight: '800' },
  updateNotes: { color: colors.textDim, fontSize: 12, marginTop: 4 },
  updateCta: { color: colors.accent2, fontSize: 12, fontWeight: '700', marginTop: 6 },
  masterBusy: { opacity: 0.6 },
  warnLine: { color: colors.warn, fontSize: 12, marginTop: spacing.md },
  modeHint: { color: colors.textDim, fontSize: 12, marginTop: spacing.sm },
  freeDesc: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  freeRow: { flexDirection: 'row', gap: spacing.md },
  freeBtn: { flex: 1 },
  freeMsg: { color: colors.accent, fontSize: 13, marginTop: spacing.md, lineHeight: 18 },
  freeDivider: { height: 1, backgroundColor: colors.border, marginTop: spacing.md },
  boosterList: { color: colors.textDim, fontSize: 12, marginBottom: spacing.sm, lineHeight: 17 },
  link: { color: colors.accent2, fontWeight: '700', fontSize: 13 },
  footnote: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
});
