/** Main boost dashboard: master switch, quick toggles, live telemetry. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  DeviceEventEmitter,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  Badge,
  PrimaryButton,
  SectionCard,
  StatCard,
  ToggleRow,
} from '../components/ui';
import { CantosHub, Telemetry } from '../native/CantosHub';
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

export default function DashboardScreen({ onGoPermissions }: { onGoPermissions: () => void }) {
  const store = useStore();
  const { activeProfile, boostRunning, permissions, autoMode, showOverlay } = store;
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [dlProgress, setDlProgress] = useState(0);
  const [cleaning, setCleaning] = useState<null | 'ram' | 'cache'>(null);
  const [cleanMsg, setCleanMsg] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('CantosHubUpdateProgress', (pct: number) =>
      setDlProgress(pct),
    );
    return () => sub.remove();
  }, []);

  const onInstall = useCallback(async () => {
    setInstalling(true);
    try {
      await store.installUpdate();
    } catch {
      setInstalling(false);
    }
  }, [store]);

  const loadTelemetry = useCallback(async () => {
    const t = await CantosHub.getTelemetry();
    if (mounted.current) setTelemetry(t);
  }, []);

  useEffect(() => {
    mounted.current = true;
    store.refreshPermissions();
    store.refreshShizuku();
    loadTelemetry();
    CantosHub.isBoostRunning().then(running => {
      if (running !== boostRunning && mounted.current) {
        // keep store in sync if the service was already running
        if (running) store.startBoost();
      }
    });
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
        freedMb > 0
          ? `Cleared ${r.targeted} apps · freed ~${freedMb} MB · ${freeGb} GB free`
          : `Cleared background in ${r.targeted} apps · ${freeGb} GB free`,
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
          : `App cache cleared (${own} MB). System-wide clearing needs Shizuku.`,
      );
    } catch {
      setCleanMsg('Could not clear cache.');
    } finally {
      setCleaning(null);
    }
  }, []);

  const therm = thermalLabel(telemetry?.thermalStatus ?? -1);
  const usedMem = telemetry ? telemetry.totalMem - telemetry.availMem : 0;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>CantosHub</Text>
          <Text style={styles.subtitle}>Game Boost</Text>
        </View>
        <Badge
          text={boostRunning ? 'BOOST ON' : 'IDLE'}
          color={boostRunning ? colors.accent : colors.textDim}
        />
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

      {/* Master boost control — tap to toggle */}
      <Pressable
        onPress={onMaster}
        disabled={busy}
        style={[styles.master, boostRunning && styles.masterOn, busy && styles.masterBusy]}>
        <Text style={[styles.masterTitle, boostRunning && styles.masterTitleOn]}>
          {busy
            ? 'WORKING…'
            : boostRunning
            ? autoMode
              ? 'AUTO BOOST ON'
              : 'BOOST ACTIVE'
            : autoMode
            ? 'START AUTO BOOST'
            : 'START BOOST'}
        </Text>
        <Text style={styles.masterProfile}>
          {boostRunning
            ? 'Tap to stop'
            : autoMode
            ? 'Auto-applies a profile per game'
            : `Profile: ${activeProfile.name}`}
        </Text>
      </Pressable>

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
          description="Battery · thermal · RAM on top of your game"
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
      </SectionCard>

      {/* Live telemetry */}
      <SectionCard title="Live status">
        <View style={styles.statGrid}>
          <StatCard
            label="Battery"
            value={telemetry ? String(telemetry.batteryLevel) : '—'}
            unit="%"
            accent={colors.accent2}
          />
          <StatCard label="Thermal" value={therm.label} accent={therm.color} />
        </View>
        <View style={[styles.statGrid, { marginTop: spacing.md }]}>
          <StatCard
            label="RAM used"
            value={telemetry ? `${gb(usedMem)}/${gb(telemetry.totalMem)}` : '—'}
            unit="GB"
          />
          <StatCard
            label="Foreground"
            value={telemetry?.foregroundApp ? appShort(telemetry.foregroundApp) : '—'}
          />
        </View>
        {telemetry?.lowMemory && (
          <Text style={styles.warnLine}>⚠️ System reports low memory</Text>
        )}
      </SectionCard>

      {/* Quick toggles */}
      <SectionCard
        title="Quick toggles"
        right={
          <Pressable onPress={onGoPermissions}>
            <Text style={styles.link}>Permissions</Text>
          </Pressable>
        }>
        {TOGGLES.map(t => {
          const unlocked = isToggleUnlocked(t.key, permissions);
          return (
            <ToggleRow
              key={t.key}
              label={t.label}
              description={t.desc}
              value={activeProfile[t.key]}
              onValueChange={v => store.toggle(t.key, v)}
              locked={!unlocked}
              lockedHint={!unlocked ? 'Tap to grant the required permission' : undefined}
              onPressLocked={onGoPermissions}
            />
          );
        })}
      </SectionCard>

      <Text style={styles.footnote}>
        100% no-root. CantosHub only uses permissions you grant — it never modifies the
        system without your say-so.
      </Text>
    </ScrollView>
  );
}

function appShort(pkg: string): string {
  const parts = pkg.split('.');
  return parts[parts.length - 1] || pkg;
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  subtitle: { color: colors.accent, fontSize: 13, fontWeight: '700', letterSpacing: 1 },
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
  master: {
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.lg,
  },
  masterOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(0,229,160,0.08)',
  },
  masterBusy: { opacity: 0.6 },
  masterTitle: { color: colors.textDim, fontSize: 22, fontWeight: '900', letterSpacing: 1 },
  masterTitleOn: { color: colors.accent },
  masterProfile: { color: colors.textDim, fontSize: 13, marginTop: 6 },
  statGrid: { flexDirection: 'row', gap: spacing.md },
  warnLine: { color: colors.warn, fontSize: 12, marginTop: spacing.md },
  modeHint: { color: colors.textDim, fontSize: 12, marginTop: spacing.sm },
  freeDesc: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  freeRow: { flexDirection: 'row', gap: spacing.md },
  freeBtn: { flex: 1 },
  freeMsg: { color: colors.accent, fontSize: 13, marginTop: spacing.md, lineHeight: 18 },
  link: { color: colors.accent2, fontWeight: '700', fontSize: 13 },
  footnote: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
});
