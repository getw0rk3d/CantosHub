/** Parent setup for Kids Mode: choose any apps, set a PIN, start the lock. */
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '../components/AppIcon';
import { Icon } from '../components/Icon';
import { PinPad } from '../components/PinPad';
import { PrimaryButton, SectionCard } from '../components/ui';
import { CantosHub } from '../native/CantosHub';
import { useStore } from '../state/store';
import { colors, spacing } from '../theme';
import { AppPickerModal } from './ProfilesScreen';

type PinStep = null | 'old' | 'new' | 'confirm';

export default function KidsScreen({ onGoPermissions }: { onGoPermissions: () => void }) {
  const store = useStore();
  const kids = store.kids;
  const allowed = kids?.allowed ?? [];
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);
  const [pinStep, setPinStep] = useState<PinStep>(null);
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    store.refreshKids();
    CantosHub.listInstalledApps()
      .then(list => setLabels(Object.fromEntries(list.map(a => [a.packageName, a.label]))))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveAllowed = async (pkgs: string[]) => {
    await CantosHub.kidsSetAllowed(pkgs);
    await store.refreshKids();
  };

  const onPinComplete = async (pin: string) => {
    if (pinStep === 'old') {
      setOldPin(pin);
      setPinError(null);
      setPinStep('new');
    } else if (pinStep === 'new') {
      setNewPin(pin);
      setPinError(null);
      setPinStep('confirm');
    } else if (pinStep === 'confirm') {
      if (pin !== newPin) {
        setPinError("PINs didn't match — enter the new PIN again");
        setPinStep('new');
        return;
      }
      const ok = await CantosHub.kidsSetPin(oldPin, pin);
      if (ok) {
        setPinStep(null);
        setOldPin('');
        await store.refreshKids();
        Alert.alert('PIN saved', 'You will need this PIN to leave Kids Mode.');
      } else {
        setPinError('Current PIN was wrong');
        setPinStep('old');
      }
    }
  };

  const onStart = async () => {
    setStarting(true);
    try {
      const r = await CantosHub.kidsStart();
      if (r === 'OK') {
        if (store.boostRunning) await store.stopBoost();
        await store.refreshKids();
        return;
      }
      const why: Record<string, string> = {
        NO_PIN: 'Set a PIN first so only you can leave Kids Mode.',
        NO_APPS: 'Choose at least one app for your kid.',
        NO_OVERLAY: 'Kids Mode needs "Display over other apps" (Access tab).',
        NO_USAGE: 'Kids Mode needs "Usage access" (Access tab).',
      };
      Alert.alert("Can't start Kids Mode", why[r] ?? r, [
        { text: 'OK' },
        ...(r === 'NO_OVERLAY' || r === 'NO_USAGE' ? [{ text: 'Open Access', onPress: onGoPermissions }] : []),
      ]);
    } finally {
      setStarting(false);
    }
  };

  const pinTitle =
    pinStep === 'old' ? 'Current PIN' : pinStep === 'new' ? 'New 4-digit PIN' : 'Confirm new PIN';

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text style={styles.title}>Kids Mode</Text>
      <Text style={styles.sub}>
        Lock the phone to the apps you choose — games or anything else. Only your PIN unlocks it.
      </Text>

      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="smile" size={30} color="#1B1446" />
        </View>
        <View style={styles.heroText}>
          <Text style={styles.heroTitle}>
            {allowed.length} app{allowed.length === 1 ? '' : 's'} allowed
          </Text>
          <Text style={styles.heroSub}>
            {kids?.hasPin ? 'PIN set' : 'No PIN yet'} ·{' '}
            {kids?.strongLock && kids?.a11yLock
              ? 'Strong lock (Shizuku + Kids lock)'
              : kids?.strongLock
                ? 'Strong lock (Shizuku)'
                : kids?.a11yLock
                  ? 'Strong lock (Kids lock)'
                  : 'Standard lock'}
          </Text>
        </View>
      </View>

      <PrimaryButton
        title={starting ? 'Starting…' : 'Start Kids Mode'}
        onPress={onStart}
        busy={starting}
        disabled={!kids?.hasPin || allowed.length === 0}
      />
      {(!kids?.hasPin || allowed.length === 0) && (
        <Text style={styles.hint}>
          {!kids?.hasPin ? 'Set a PIN' : ''}
          {!kids?.hasPin && allowed.length === 0 ? ' and choose apps' : allowed.length === 0 ? 'Choose apps' : ''} to
          start.
        </Text>
      )}

      <SectionCard
        title="Allowed apps"
        right={
          <Pressable onPress={() => setPicking(true)} hitSlop={8}>
            <Text style={styles.link}>{allowed.length ? 'Edit' : 'Choose'}</Text>
          </Pressable>
        }>
        {allowed.length === 0 ? (
          <Text style={styles.dim}>Tap Choose to pick which apps your kid can use.</Text>
        ) : (
          <View style={styles.appGrid}>
            {allowed.map(p => (
              <View key={p} style={styles.appCell}>
                <AppIcon packageName={p} label={labels[p] ?? p} size={48} />
                <Text style={styles.appLabel} numberOfLines={1}>
                  {labels[p] ?? p.split('.').pop()}
                </Text>
              </View>
            ))}
          </View>
        )}
      </SectionCard>

      <SectionCard title="Kids lock (no Shizuku needed)">
        <Text style={styles.dim}>
          {kids?.a11yLock
            ? 'On. Works on mobile data too: closes the notification shade and Samsung Wallet’s swipe-up card, and always brings your kid back to their apps.'
            : 'Shizuku needs Wi-Fi to start, so on mobile data the lock is weaker. Turn on “CantosHub Kids lock” in Accessibility (Installed apps) for a strong lock anywhere. It does nothing while Kids Mode is off.'}
          {!kids?.a11yLock
            ? '\n\nIf Android says it’s a restricted setting: open App info for CantosHub, tap ⋮ (top right) → Allow restricted settings, then try again.'
            : ''}
        </Text>
        {!kids?.a11yLock && (
          <View style={{ marginTop: spacing.md }}>
            <PrimaryButton
              title="Turn on Kids lock"
              variant="outline"
              onPress={() => CantosHub.openAccessibilitySettings()}
            />
            <Pressable onPress={() => CantosHub.openPermissionSettings('appDetails')} hitSlop={8} style={{ marginTop: spacing.sm }}>
              <Text style={[styles.link, { textAlign: 'center' }]}>Open App info</Text>
            </Pressable>
          </View>
        )}
      </SectionCard>

      <SectionCard title="Parent PIN">
        <Text style={styles.dim}>
          {kids?.hasPin
            ? 'Needed to leave Kids Mode.'
            : 'Choose a 4-digit PIN your kid doesn’t know.'}
          {kids?.deviceSecure ? ' If you forget it, your phone’s own lock screen can unlock Kids Mode.' : ''}
        </Text>
        <View style={{ marginTop: spacing.md }}>
          <PrimaryButton
            title={kids?.hasPin ? 'Change PIN' : 'Set PIN'}
            variant="outline"
            onPress={() => {
              setPinError(null);
              setOldPin('');
              setPinStep(kids?.hasPin ? 'old' : 'new');
            }}
          />
        </View>
      </SectionCard>

      <SectionCard title="How the lock works">
        <Text style={styles.dim}>
          • Any app that isn't allowed is covered right away and your kid is sent back to their
          apps.{'\n'}• Calls always come through.{'\n'}
          {kids?.strongLock
            ? '• Shizuku is on: the notification shade and Recents are disabled and CantosHub becomes the Home screen until you unlock.'
            : kids?.a11yLock
              ? '• Kids lock is on: the notification shade, Recents and Home all lead straight back to the kids screen.'
              : '• For a stronger lock (no notification shade or Recents), turn on Kids lock above or Shizuku in the Access tab.'}
          {'\n'}• Kids Mode stays on after a restart until you unlock it.
        </Text>
      </SectionCard>

      <AppPickerModal
        visible={picking}
        initialSelected={allowed}
        title="Kids apps"
        subtitle="Pick any apps your kid is allowed to use."
        onClose={() => setPicking(false)}
        onSave={sel => {
          setPicking(false);
          saveAllowed(sel);
        }}
      />

      <PinPad
        visible={pinStep !== null}
        title={pinTitle}
        error={pinError}
        onComplete={onPinComplete}
        onCancel={() => setPinStep(null)}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { color: colors.text, fontSize: 26, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 4, marginBottom: spacing.lg, lineHeight: 19 },
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1B1446',
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  heroIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#FFD43B', alignItems: 'center', justifyContent: 'center' },
  heroText: { marginLeft: spacing.md, flex: 1 },
  heroTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  heroSub: { color: '#C9C3FF', fontSize: 13, marginTop: 2 },
  hint: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: spacing.sm },
  link: { color: colors.accent2, fontWeight: '700', fontSize: 14 },
  dim: { color: colors.textDim, fontSize: 13, lineHeight: 20 },
  appGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  appCell: { width: 64, alignItems: 'center' },
  appLabel: { color: colors.text, fontSize: 11, marginTop: 4 },
});
