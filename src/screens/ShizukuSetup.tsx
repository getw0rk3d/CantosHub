/**
 * PRO access setup (Access tab). Recommended: CantosHub pairs once with the phone's own
 * Wireless debugging and runs its shell commands itself (AdbShell / AdbPairingService) - no
 * other app. The Shizuku app still works as the alternative. Live status while pairing.
 */
import React, { useEffect } from 'react';
import { Linking, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Badge, PrimaryButton } from '../components/ui';
import { CantosHub } from '../native/CantosHub';
import { useStore } from '../state/store';
import { colors, radius, spacing } from '../theme';

const PAIRING_TEXT: Record<string, string> = {
  searching: 'Waiting for the pairing code… In Wireless debugging tap Pair device with pairing code.',
  ready: 'Found it. Pull down the CantosHub notification and type the 6-digit code.',
  pairing: 'Pairing…',
  connected: '✓ Paired and connected.',
  failed: 'That code didn’t work. Tap Pair device with pairing code again for a new one.',
};

export default function ShizukuSetup({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const store = useStore();
  const { shizuku } = store;
  const b = shizuku?.builtIn;

  // While open, follow the pairing as it happens in Settings and the notification.
  useEffect(() => {
    if (!visible) return;
    store.refreshShizuku();
    const t = setInterval(() => store.refreshShizuku(), 1500);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const status = shizuku?.granted
    ? { text: 'ON', color: colors.accent }
    : b?.paired
    ? { text: 'NOT CONNECTED', color: colors.warn }
    : { text: 'OFF', color: colors.textDim };

  const pairing = b?.pairing && b.pairing !== 'idle' ? PAIRING_TEXT[b.pairing] : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.header}>
            <Text style={styles.title}>PRO access</Text>
            <Badge text={status.text} color={status.color} />
          </View>
          <Text style={styles.sub}>
            Unlocks the PRO features (lower resolution, freeze apps, Free RAM, hide games, Kids
            top-bar lock, system-wide cache trim) with <Text style={styles.bold}>no root</Text>.
            CantosHub pairs once with your phone’s Wireless debugging — no other app needed.
          </Text>

          {shizuku?.granted ? (
            <View style={styles.doneCard}>
              <Text style={styles.doneText}>
                {shizuku.via === 'shizuku'
                  ? '✓ Connected through Shizuku. PRO features are on.'
                  : '✓ Connected. PRO features are on.'}
              </Text>
              {shizuku.via !== 'shizuku' && (
                <Text style={styles.doneSub}>
                  {b?.autoStart
                    ? 'After a restart CantosHub turns Wireless debugging back on and reconnects by itself whenever you’re on Wi-Fi.'
                    : 'After a restart, turn Wireless debugging on again and tap Reconnect here.'}
                </Text>
              )}
            </View>
          ) : b?.paired ? (
            <Step n={1} title="Reconnect">
              <Text style={styles.stepText}>
                {b.wifi
                  ? 'CantosHub is paired. Tap Reconnect — it turns Wireless debugging on and connects.'
                  : 'Connect to Wi-Fi first: Wireless debugging only works on Wi-Fi (any network, no internet needed).'}
              </Text>
              <View style={styles.stepBtn}>
                <PrimaryButton
                  title="Reconnect"
                  onPress={async () => {
                    await CantosHub.reconnectBuiltIn();
                    store.refreshShizuku();
                  }}
                />
              </View>
              <View style={styles.stepBtn}>
                <PrimaryButton title="Pair again" variant="outline" onPress={() => CantosHub.startBuiltInPairing()} />
              </View>
            </Step>
          ) : (
            <>
              <Step n={1} title={b?.devOptions ? 'Developer options ✓' : 'Turn on Developer options'}>
                <Text style={styles.stepText}>
                  {b?.devOptions
                    ? 'Developer options are on.'
                    : 'Open Settings → About phone → Software information and tap Build number 7 times (enter your phone’s PIN if asked).'}
                </Text>
                {!b?.devOptions && (
                  <View style={styles.stepBtn}>
                    <PrimaryButton title="Open Settings" variant="outline" onPress={() => CantosHub.openDevSettings()} />
                  </View>
                )}
              </Step>

              <Step n={2} title="Pair (one time)">
                <Text style={styles.stepText}>
                  Tap Start pairing. In <Text style={styles.bold}>Wireless debugging</Text> turn it on
                  (allow your Wi-Fi network), then tap{' '}
                  <Text style={styles.bold}>Pair device with pairing code</Text>. Pull down the
                  CantosHub notification and type the 6-digit code — stay on the code screen while
                  you do. Needs Wi-Fi (any network, no internet needed).
                </Text>
                {!!pairing && <Text style={styles.live}>{pairing}</Text>}
                <View style={styles.stepBtn}>
                  <PrimaryButton
                    title={pairing ? 'Open Wireless debugging again' : 'Start pairing'}
                    onPress={() => CantosHub.startBuiltInPairing()}
                    disabled={!b?.devOptions}
                  />
                </View>
                {!!pairing && b?.pairing !== 'connected' && (
                  <View style={styles.stepBtn}>
                    <PrimaryButton title="Cancel pairing" variant="outline" onPress={() => CantosHub.stopBuiltInPairing()} />
                  </View>
                )}
              </Step>
            </>
          )}

          {shizuku?.via !== 'builtin' && (
            <View style={styles.alt}>
              <Text style={styles.altTitle}>Or use the Shizuku app</Text>
              <Text style={styles.altText}>
                {shizuku?.shizukuGranted
                  ? 'Shizuku is running and CantosHub is allowed.'
                  : shizuku?.shizukuRunning
                  ? 'Shizuku is running — allow CantosHub in it.'
                  : 'If you already use Shizuku, start it and allow CantosHub. Get it from GitHub or F-Droid (not the Play Store build, it’s outdated).'}
              </Text>
              {!shizuku?.shizukuGranted && (
                <View style={styles.stepBtn}>
                  <PrimaryButton
                    title={shizuku?.shizukuRunning ? 'Allow CantosHub in Shizuku' : 'Get Shizuku (GitHub)'}
                    variant="outline"
                    onPress={() =>
                      shizuku?.shizukuRunning
                        ? store.requestShizuku()
                        : Linking.openURL('https://github.com/RikkaApps/Shizuku/releases/latest')
                    }
                  />
                </View>
              )}
            </View>
          )}

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
      <View style={styles.stepBody}>{children}</View>
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
  doneSub: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginTop: spacing.sm },
  live: { color: colors.accent2, fontSize: 14, fontWeight: '700', lineHeight: 20, marginTop: spacing.md },

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
  stepBody: {},
  stepText: { color: colors.textDim, fontSize: 14, lineHeight: 21 },
  stepBtn: { marginTop: spacing.md },

  alt: {
    marginTop: spacing.xl,
    padding: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
  },
  altTitle: { color: colors.accent2, fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  altText: { color: colors.textDim, fontSize: 13, lineHeight: 20, marginTop: 6 },
});
