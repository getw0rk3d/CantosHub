/** Main boost dashboard: master switch, quick toggles, live telemetry. */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
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
  const { activeProfile, boostRunning, permissions } = store;
  const [telemetry, setTelemetry] = useState<Telemetry | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const loadTelemetry = useCallback(async () => {
    const t = await CantosHub.getTelemetry();
    if (mounted.current) setTelemetry(t);
  }, []);

  useEffect(() => {
    mounted.current = true;
    store.refreshPermissions();
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

      {!CantosHub.isNativeAvailable && (
        <View style={styles.notice}>
          <Text style={styles.noticeText}>
            Native module not built yet — showing demo data. Run an Android build to go live.
          </Text>
        </View>
      )}

      {/* Master boost control */}
      <Pressable
        onPress={onMaster}
        disabled={busy}
        style={[styles.master, boostRunning && styles.masterOn]}>
        <Text style={[styles.masterTitle, boostRunning && styles.masterTitleOn]}>
          {boostRunning ? 'BOOST ACTIVE' : 'START BOOST'}
        </Text>
        <Text style={styles.masterProfile}>Profile: {activeProfile.name}</Text>
      </Pressable>
      <View style={{ height: spacing.lg }}>
        <PrimaryButton
          title={boostRunning ? 'Stop boost' : 'Start boost'}
          onPress={onMaster}
          busy={busy}
          variant={boostRunning ? 'danger' : 'solid'}
        />
      </View>

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
  master: {
    borderRadius: 18,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
    paddingVertical: spacing.xl,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  masterOn: {
    borderColor: colors.accent,
    backgroundColor: 'rgba(0,229,160,0.08)',
  },
  masterTitle: { color: colors.textDim, fontSize: 22, fontWeight: '900', letterSpacing: 1 },
  masterTitleOn: { color: colors.accent },
  masterProfile: { color: colors.textDim, fontSize: 13, marginTop: 6 },
  statGrid: { flexDirection: 'row', gap: spacing.md },
  warnLine: { color: colors.warn, fontSize: 12, marginTop: spacing.md },
  link: { color: colors.accent2, fontWeight: '700', fontSize: 13 },
  footnote: {
    color: colors.textDim,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.sm,
  },
});
