/**
 * Permissions screen — the heart of the "no-root, owner-grants-access" model.
 * Every capability maps to a single Android special-access permission the user
 * toggles in system Settings. Nothing here needs root.
 */
import React, { useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, PrimaryButton, SectionCard, StatusDot } from '../components/ui';
import { CantosHub, PermissionKey } from '../native/CantosHub';
import { useStore } from '../state/store';
import { colors, spacing } from '../theme';

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
    why: 'For the live FPS / temperature overlay on top of games (coming soon).',
  },
];

export default function PermissionsScreen() {
  const store = useStore();
  const { permissions } = store;

  const { shizuku } = store;

  useEffect(() => {
    store.refreshPermissions();
    store.refreshShizuku();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Permissions</Text>
      <Text style={styles.sub}>
        CantosHub is 100% no-root. It can only do what you allow here — tap a row to open
        the system settings and grant it. Revoke any of these any time.
      </Text>

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
        title="Pro tier · Shizuku"
        right={
          shizuku ? (
            <Badge
              text={shizuku.granted ? 'AUTHORIZED' : shizuku.available ? 'NOT AUTHORIZED' : 'NOT RUNNING'}
              color={shizuku.granted ? colors.accent : shizuku.available ? colors.warn : colors.textDim}
            />
          ) : undefined
        }>
        <Text style={styles.note}>
          <Text style={styles.bold}>Shizuku</Text> grants CantosHub ADB-level powers
          (per-game resolution scaling, freezing background apps) with{' '}
          <Text style={styles.bold}>still no root</Text> — you authorize it once and stay
          in control.
        </Text>

        {shizuku?.granted ? (
          <Text style={[styles.note, { color: colors.accent, marginTop: spacing.sm }]}>
            ✓ Connected — Pro options are unlocked in Profiles.
          </Text>
        ) : shizuku?.available ? (
          <View style={{ marginTop: spacing.md }}>
            <PrimaryButton title="Authorize CantosHub" onPress={() => store.requestShizuku()} />
          </View>
        ) : (
          <View style={{ marginTop: spacing.sm }}>
            <Text style={styles.note}>To enable (one time, no root):</Text>
            <Text style={styles.step}>1. Install the Shizuku app from the Play Store.</Text>
            <Text style={styles.step}>
              2. Start it via wireless debugging (Shizuku walks you through it) or a PC over ADB.
            </Text>
            <Text style={styles.step}>3. Come back here and tap Authorize.</Text>
            <View style={{ marginTop: spacing.md }}>
              <PrimaryButton
                title="Re-check Shizuku"
                variant="outline"
                onPress={() => store.refreshShizuku()}
              />
            </View>
          </View>
        )}
      </SectionCard>
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
});
