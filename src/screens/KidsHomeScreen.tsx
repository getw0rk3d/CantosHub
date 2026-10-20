/**
 * What a child sees while Kids Mode is on: only the parent's chosen apps, big and
 * friendly. Leaving needs the parent PIN (or the phone's own lock screen check).
 */
import React, { useEffect, useState } from 'react';
import { BackHandler, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppIcon } from '../components/AppIcon';
import { Icon } from '../components/Icon';
import { PinPad } from '../components/PinPad';
import { CantosHub } from '../native/CantosHub';
import { useStore } from '../state/store';

const KID_BG = '#1B1446';
const TILE_COLORS = ['#FF6B6B', '#4DABF7', '#51CF66', '#FFD43B', '#CC5DE8', '#FF922B'];

export default function KidsHomeScreen() {
  const store = useStore();
  const allowed = store.kids?.allowed ?? [];
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    CantosHub.listInstalledApps()
      .then(list => setLabels(Object.fromEntries(list.map(a => [a.packageName, a.label]))))
      .catch(() => {});
  }, []);

  // Back does nothing on the kids screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, []);

  const apps = allowed
    .filter(p => labels[p] !== undefined || Object.keys(labels).length === 0)
    .map(p => ({ pkg: p, label: labels[p] ?? p.split('.').pop() ?? p }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const onPin = async (pin: string) => {
    const ok = await CantosHub.kidsStop(pin);
    if (ok) {
      setUnlocking(false);
      setError(null);
      await store.refreshKids();
    } else {
      setError('Wrong PIN — try again');
    }
  };

  const onDeviceUnlock = async () => {
    const ok = await CantosHub.kidsUnlockWithDeviceCredential();
    if (ok) {
      setUnlocking(false);
      await store.refreshKids();
    } else {
      setError("Couldn't confirm with the phone's lock");
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <View>
          <Text style={styles.hi}>Hi there! 👋</Text>
          <Text style={styles.pick}>Pick something to play</Text>
        </View>
        <Pressable
          onPress={() => {
            setError(null);
            setUnlocking(true);
          }}
          style={styles.lockBtn}
          accessibilityLabel="Parent: exit Kids Mode">
          <Icon name="lock" size={20} color="#C9C3FF" />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.grid}>
        {apps.map((a, i) => (
          <Pressable
            key={a.pkg}
            onPress={() => CantosHub.launchApp(a.pkg)}
            style={({ pressed }) => [styles.tile, { backgroundColor: TILE_COLORS[i % TILE_COLORS.length] }, pressed && styles.tilePressed]}>
            <View style={styles.iconBg}>
              <AppIcon packageName={a.pkg} label={a.label} size={72} />
            </View>
            <Text style={styles.tileLabel} numberOfLines={2}>
              {a.label}
            </Text>
          </Pressable>
        ))}
        {apps.length === 0 && (
          <Text style={styles.empty}>No apps yet — ask a grown-up to add some.</Text>
        )}
      </ScrollView>

      <PinPad
        visible={unlocking}
        title="Grown-ups only"
        subtitle="Enter your Kids Mode PIN to unlock the phone"
        error={error}
        onComplete={onPin}
        onCancel={() => setUnlocking(false)}
        footer={
          store.kids?.deviceSecure ? (
            <Pressable onPress={onDeviceUnlock} style={styles.forgot} hitSlop={8}>
              <Text style={styles.forgotText}>Forgot PIN? Use the phone's lock</Text>
            </Pressable>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: KID_BG },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, paddingBottom: 12 },
  hi: { color: '#FFFFFF', fontSize: 30, fontWeight: '900' },
  pick: { color: '#C9C3FF', fontSize: 16, marginTop: 4 },
  lockBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 40 },
  tile: { width: '47%', borderRadius: 28, paddingVertical: 22, alignItems: 'center', marginBottom: 18 },
  tilePressed: { transform: [{ scale: 0.96 }] },
  iconBg: { backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 24, padding: 6 },
  tileLabel: { color: '#1B1446', fontSize: 17, fontWeight: '800', marginTop: 12, textAlign: 'center', paddingHorizontal: 10 },
  empty: { color: '#C9C3FF', fontSize: 16, textAlign: 'center', width: '100%', marginTop: 60 },
  forgot: { marginTop: 14 },
  forgotText: { color: '#3B82F6', fontSize: 14, fontWeight: '600' },
});
