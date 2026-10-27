/**
 * Permissions screen — the heart of the "no-root, owner-grants-access" model.
 * Every capability maps to a single Android special-access permission the user
 * toggles in system Settings. Nothing here needs root.
 */
import React, { useEffect, useState } from 'react';
import { Alert, AppState, DeviceEventEmitter, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, PrimaryButton, ProBadge, SectionCard, StatusDot } from '../components/ui';
import { CantosHub, PermissionKey, VersionInfo } from '../native/CantosHub';
import { useStore } from '../state/store';
import { colors, spacing } from '../theme';
import ShizukuSetup from './ShizukuSetup';
import { GUIDE_ORDER, usePermissionGuide } from './usePermissionGuide';

const PERMISSIONS: { key: PermissionKey; label: string; why: string }[] = [
  {
    key: 'notifications',
    label: 'Notifications',
    why: 'Shows the persistent boost notification — required for the background service.',
  },
  {
    key: 'dndAccess',
    label: 'Do Not Disturb access',
    why: 'Lets CantosHub turn on DND while you game.',
  },
  {
    key: 'writeSettings',
    label: 'Modify system settings',
    why: 'Adjust refresh rate, brightness and screen timeout during a boost.',
  },
  {
    key: 'usageAccess',
    label: 'Usage access',
    why: 'Detect the foreground game so profiles can auto-apply (and show live status).',
  },
  {
    key: 'ignoreBatteryOptimizations',
    label: 'Ignore battery optimizations',
    why: 'Keeps the boost service running reliably in the background.',
  },
  {
    key: 'overlay',
    label: 'Display over other apps',
    why: 'For the live FPS / battery / RAM overlay on top of your game.',
  },
];

export default function PermissionsScreen() {
  const store = useStore();
  const { permissions } = store;

  const { shizuku, update } = store;
  const [version, setVersion] = useState<VersionInfo | null>(null);
  const [setupOpen, setSetupOpen] = useState(false);
  // The update button: busy while downloading, with progress (it gave no feedback, and more
  // taps started more downloads).
  const [installing, setInstalling] = useState(false);
  const [dlPct, setDlPct] = useState(0);
  const { refreshPermissions } = store;
  const startGuide = usePermissionGuide(refreshPermissions);
  const ready = permissions ? GUIDE_ORDER.filter(k => permissions[k]).length : 0;
  const total = GUIDE_ORDER.length;

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('CantosHubUpdateProgress', (pct: number) => setDlPct(pct));
    return () => sub.remove();
  }, []);

  // Back from the installer or the "Install unknown apps" page: the button works again.
  useEffect(() => {
    if (!installing) return;
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active' && dlPct >= 100) setInstalling(false);
    });
    return () => sub.remove();
  }, [installing, dlPct]);

  const onInstall = async () => {
    setInstalling(true);
    setDlPct(0);
    try {
      const r = await store.installUpdate();
      if (r !== 'INSTALLING' && r !== 'BUSY') setInstalling(false);
    } catch {
      setInstalling(false);
      Alert.alert('Update failed', 'The download didn’t finish. Check your connection and try again.');
    }
  };

  useEffect(() => {
    store.refreshPermissions();
    store.refreshShizuku();
    store.checkForUpdate();
    CantosHub.getVersionInfo().then(setVersion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Permissions</Text>
      <Text style={styles.sub}>
        CantosHub is 100% no-root. It can only do what you allow here — tap a row to open
        the system settings and grant it. Revoke any of these any time.
      </Text>

      {/* Guided setup: one tap walks through every missing permission (no Shizuku needed). */}
      <SectionCard title="Setup">
        <Text style={styles.note}>
          {ready === total
            ? 'Everything CantosHub needs is on.'
            : `${ready} of ${total} ready. CantosHub opens each Settings screen for you and tells you which switch to turn on.`}
        </Text>
        <View style={styles.progress}>
          <View style={[styles.progressFill, { width: `${(ready / total) * 100}%` }]} />
        </View>
        {ready < total && (
          <View style={styles.setupBtn}>
            <PrimaryButton title={ready === 0 ? 'Start setup' : 'Continue setup'} onPress={startGuide} />
          </View>
        )}
      </SectionCard>

      <SectionCard
        right={
          <Pressable onPress={() => store.refreshPermissions()}>
            <Text style={styles.link}>Refresh</Text>
          </Pressable>
        }>
        {PERMISSIONS.map((p, i) => {
          const granted = permissions ? permissions[p.key] : false;
          return (
            <Pressable
              key={p.key}
              onPress={() => CantosHub.openPermissionSettings(p.key)}
              style={[styles.row, i > 0 && styles.rowBorder]}
              android_ripple={{ color: colors.border }}>
              <View style={styles.dotWrap}>
                <StatusDot ok={granted} />
              </View>
              <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{p.label}</Text>
                <Text style={styles.rowWhy}>{p.why}</Text>
              </View>
              <Text style={[styles.action, granted && styles.actionGranted]}>
                {granted ? 'Granted' : 'Grant'}
              </Text>
            </Pressable>
          );
        })}
      </SectionCard>

      <SectionCard
        title="Extras · Shizuku (optional)"
        right={
          shizuku ? (
            <Badge
              text={shizuku.granted ? 'AUTHORIZED' : shizuku.available ? 'NOT AUTHORIZED' : 'NOT RUNNING'}
              color={shizuku.granted ? colors.accent : shizuku.available ? colors.warn : colors.textDim}
            />
          ) : undefined
        }>
        <Text style={styles.note}>
          <Text style={styles.bold}>You don’t need it.</Text> Boosting, Auto by game,
          the overlay and Kids Mode all work with the permissions above. Android only lets a
          shell do a few things, so these are marked <ProBadge style={styles.proMid} /> and
          need <Text style={styles.bold}>Shizuku</Text> (still no root):
        </Text>
        {[
          'Lower resolution for more FPS',
          'Freeze background apps while gaming',
          'Clear every app’s cache at once',
          ...(Platform.OS === 'android' && Number(Platform.Version) >= 34
            ? ['Free RAM (Android 14 and newer only let a shell close other apps)']
            : []),
          'Live FPS in the overlay',
          'Block Samsung Game Booster',
          'Hide games instantly (without it, CantosHub opens Samsung’s Hide apps page)',
        ].map(t => (
          <Text key={t} style={styles.step}>•  {t}</Text>
        ))}
        <Text style={[styles.note, { marginTop: spacing.sm }]}>
          Shizuku needs Wi-Fi to start and stops when the phone restarts.
        </Text>

        {shizuku?.granted ? (
          <Text style={[styles.note, styles.grantedNote]}>
            ✓ Connected — Pro options are unlocked in Profiles.
          </Text>
        ) : (
          <View style={styles.setupBtn}>
            <PrimaryButton title="Set up Shizuku" onPress={() => setSetupOpen(true)} />
          </View>
        )}
      </SectionCard>

      <SectionCard
        title="Updates"
        right={
          update ? (
            <Badge
              text={update.available ? 'UPDATE READY' : 'UP TO DATE'}
              color={update.available ? colors.accent : colors.textDim}
            />
          ) : undefined
        }>
        <Text style={styles.note}>
          Installed: v{version?.versionName ?? '—'} (build {version?.versionCode ?? '—'})
        </Text>
        {update?.available ? (
          <View style={{ marginTop: spacing.md }}>
            {!!update.notes && (
              <Text style={[styles.note, { marginBottom: spacing.sm }]}>{update.notes}</Text>
            )}
            <PrimaryButton
              title={installing ? `Downloading… ${dlPct}%` : `Install v${update.versionName}`}
              onPress={onInstall}
              busy={installing && dlPct === 0}
              disabled={installing}
            />
          </View>
        ) : (
          <View style={{ marginTop: spacing.md }}>
            <PrimaryButton
              title="Check for updates"
              variant="outline"
              onPress={() => store.checkForUpdate()}
            />
          </View>
        )}
      </SectionCard>

      <ShizukuSetup visible={setupOpen} onClose={() => setSetupOpen(false)} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { color: colors.text, fontSize: 24, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 4, marginBottom: spacing.lg, lineHeight: 19 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  rowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  dotWrap: { width: 22, alignItems: 'center' },
  rowText: { flex: 1, paddingHorizontal: spacing.sm },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowWhy: { color: colors.textDim, fontSize: 12, marginTop: 2, lineHeight: 17 },
  action: { color: colors.accent2, fontWeight: '800', fontSize: 13 },
  actionGranted: { color: colors.accent },
  link: { color: colors.accent2, fontWeight: '700', fontSize: 13 },
  note: { color: colors.textDim, fontSize: 13, lineHeight: 20 },
  step: { color: colors.textDim, fontSize: 13, lineHeight: 20, marginTop: 4 },
  bold: { color: colors.text, fontWeight: '700' },
  grantedNote: { color: colors.accent, marginTop: spacing.sm },
  setupBtn: { marginTop: spacing.md },
  progress: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: spacing.md, overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
  proMid: { marginTop: 2 },
});
