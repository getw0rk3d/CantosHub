/**
 * In-app Shizuku setup (Stage 1): live status + a direct deep-link to Wireless
 * Debugging + the step-by-step guide, all inside CantosHub instead of a webpage.
 *
 * Stage 2 (planned) will drive the wireless-debugging pairing and start Shizuku
 * from here with no separate app — that needs an embedded ADB client and is
 * tested together on-device.
 */
import React, { useEffect } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, PrimaryButton } from '../components/ui';
import { CantosHub } from '../native/CantosHub';
import { useStore } from '../state/store';
import { colors, radius, spacing } from '../theme';

export default function ShizukuSetup({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const store = useStore();
  const { shizuku } = store;

  useEffect(() => {
    if (visible) store.refreshShizuku();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const status = shizuku?.granted
    ? { text: 'AUTHORIZED', color: colors.accent }
    : shizuku?.available
    ? { text: 'RUNNING — NOT AUTHORIZED', color: colors.warn }
    : { text: 'NOT RUNNING', color: colors.textDim };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>Set up Shizuku</Text>
            <Badge text={status.text} color={status.color} />
          </View>
          <Text style={styles.sub}>
            Shizuku unlocks the Pro features (per-game resolution, freeze apps, hide games,
            system-wide cache trim) with <Text style={styles.bold}>no root</Text>. It's a
            one-time setup you do right here.
          </Text>

          {shizuku?.granted ? (
            <View style={styles.doneCard}>
              <Text style={styles.doneText}>
                ✓ Shizuku is connected and authorized. Pro features are unlocked.
              </Text>
            </View>
          ) : (
            <>
              <Step n={1} title="Turn on Wireless debugging">
                Open Developer Options and enable <Text style={styles.bold}>Wireless debugging</Text>.
                (If you don't see Developer Options, open Settings → About phone and tap
                Build number 7 times first.)
                {'\n'}
                <View style={styles.stepBtn}>
                  <PrimaryButton
                    title="Open Developer Options"
                    onPress={() => CantosHub.openDevSettings()}
                  />
                </View>
              </Step>

              <Step n={2} title="Start Shizuku (one time)">
                Until in-app pairing lands, install <Text style={styles.bold}>Shizuku</Text>{' '}
                from GitHub (RikkaApps/Shizuku) or F-Droid and start it via Wireless debugging —
                Shizuku walks you through the pairing. Do not use the Play Store build (it's
                outdated).
              </Step>

              <Step n={3} title="Authorize CantosHub">
                Once Shizuku is running, tap Authorize below and allow CantosHub.
                {'\n'}
                <View style={styles.stepBtn}>
                  <PrimaryButton
                    title={shizuku?.available ? 'Authorize CantosHub' : 'Re-check Shizuku'}
                    onPress={() =>
                      shizuku?.available ? store.requestShizuku() : store.refreshShizuku()
                    }
                  />
                </View>
              </Step>
            </>
          )}

          <View style={styles.roadmap}>
            <Text style={styles.roadmapTitle}>Coming: zero separate app</Text>
            <Text style={styles.roadmapText}>
              We're building pairing + starting Shizuku directly inside CantosHub, so you won't
              need any other app — just the one-time Wireless-debugging pair. That step will
              appear here when ready.
            </Text>
          </View>

          <View style={{ height: spacing.lg }}>
            <PrimaryButton title="Close" variant="outline" onPress={onClose} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.step}>
      <View style={styles.stepHead}>
        <View style={styles.stepNum}>
          <Text style={styles.stepNumText}>{n}</Text>
        </View>
        <Text style={styles.stepTitle}>{title}</Text>
      </View>
      <Text style={styles.stepBody}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
  },
  title: { color: colors.text, fontSize: 24, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 14, lineHeight: 21, marginTop: spacing.sm },
  bold: { color: colors.text, fontWeight: '700' },

  doneCard: {
    backgroundColor: 'rgba(0,229,160,0.10)',
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  doneText: { color: colors.accent, fontSize: 15, fontWeight: '700' },

  step: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  stepHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  stepNumText: { color: '#06140F', fontWeight: '900' },
  stepTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  stepBody: { color: colors.textDim, fontSize: 14, lineHeight: 21 },
  stepBtn: { marginTop: spacing.md },

  roadmap: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  roadmapTitle: { color: colors.accent2, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  roadmapText: { color: colors.textDim, fontSize: 13, lineHeight: 20, marginTop: 6 },
});
