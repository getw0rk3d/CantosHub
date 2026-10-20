/**
 * Quick ways to add apps to CantosHub without hunting through lists:
 * - New installs: on open, apps installed since the last check get an
 *   "Add to Games / Kids apps?" card (one tap each).
 * - Share: Play Store / Galaxy Store page → Share → CantosHub gives the same card.
 * - "Add game" app-icon shortcut: opens the app picker straight away.
 * Never shown while Kids Mode is on (App.tsx only renders this for parents).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { CantosHub } from '../native/CantosHub';
import { AppPickerModal } from '../screens/ProfilesScreen';
import { useStore } from '../state/store';
import { colors, spacing } from '../theme';
import { AppIcon } from './AppIcon';
import { PrimaryButton } from './ui';

const LAST_CHECK_KEY = 'cantoshub_last_app_check';
const ASK_NEW_KEY = 'cantoshub_ask_new_apps';

type Offer = { packageName: string; label: string; isGame: boolean; source: 'new' | 'share' };

export function AddAppsPrompt() {
  const store = useStore();
  const { hydrated, kids, addedGames, addGames, removeAddedGame, refreshKids } = store;
  const [queue, setQueue] = useState<Offer[]>([]);
  const [picking, setPicking] = useState(false);
  const busy = useRef(false);
  const latest = useRef({ addedGames, kids });
  latest.current = { addedGames, kids };

  const inGames = (o: { packageName: string; isGame: boolean }) =>
    o.isGame || latest.current.addedGames.some(a => a.packageName === o.packageName);
  const inKids = (pkg: string) => (latest.current.kids?.allowed ?? []).includes(pkg);

  const enqueue = (offers: Offer[]) =>
    setQueue(prev => [...prev, ...offers.filter(o => !prev.some(p => p.packageName === o.packageName))]);

  const check = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      // 1. Share sheet / "Add game" shortcut
      const pending = await CantosHub.takePendingAdd();
      if (pending?.kind === 'pick') {
        setPicking(true);
      } else if (pending?.kind === 'share') {
        if (!pending.packageName) {
          Alert.alert(
            "Couldn't find the app",
            'Share from the app’s page in the Play Store or Galaxy Store and pick CantosHub.',
          );
        } else if (!pending.installed) {
          Alert.alert(
            'Not installed yet',
            'Install it first. Next time you open CantosHub it will offer to add it.',
          );
        } else {
          enqueue([
            {
              packageName: pending.packageName,
              label: pending.label ?? pending.packageName,
              isGame: !!pending.isGame,
              source: 'share',
            },
          ]);
        }
      }

      // 2. Apps installed since the last check (the first run only sets the baseline)
      const now = Date.now();
      const last = Number(await AsyncStorage.getItem(LAST_CHECK_KEY)) || 0;
      await AsyncStorage.setItem(LAST_CHECK_KEY, String(now));
      if (last > 0 && (await AsyncStorage.getItem(ASK_NEW_KEY)) !== '0') {
        const fresh = await CantosHub.listAppsInstalledSince(last);
        enqueue(
          fresh
            .filter(a => !(inGames(a) && inKids(a.packageName)))
            .map(a => ({ ...a, source: 'new' as const })),
        );
      }
    } catch {
      // best effort
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    check();
    const sub = AppState.addEventListener('change', s => s === 'active' && check());
    return () => sub.remove();
  }, [hydrated, check]);

  const offer = queue[0];
  const next = () => setQueue(prev => prev.slice(1));

  const addToKids = async (pkg: string) => {
    await CantosHub.kidsSetAllowed([...(kids?.allowed ?? []), pkg]);
    await refreshKids();
  };

  const savePicked = async (selected: string[]) => {
    setPicking(false);
    const labels = Object.fromEntries((await CantosHub.listInstalledApps()).map(a => [a.packageName, a.label]));
    addedGames.filter(a => !selected.includes(a.packageName)).forEach(a => removeAddedGame(a.packageName));
    addGames(selected.map(p => ({ packageName: p, label: labels[p] ?? p })));
  };

  return (
    <>
      <Modal visible={!!offer && !picking} transparent animationType="fade" onRequestClose={next}>
        <View style={styles.backdrop}>
          {offer && (
            <View style={styles.card}>
              <Text style={styles.eyebrow}>
                {offer.source === 'new' ? 'NEW APP INSTALLED' : 'ADD TO CANTOSHUB'}
                {queue.length > 1 ? `  ·  1 of ${queue.length}` : ''}
              </Text>
              <View style={styles.appRow}>
                <AppIcon packageName={offer.packageName} label={offer.label} size={56} />
                <Text style={styles.label} numberOfLines={2}>
                  {offer.label}
                </Text>
              </View>

              {inGames(offer) ? (
                <Text style={styles.done}>✓ In Games</Text>
              ) : (
                <PrimaryButton
                  title="Add to Games"
                  onPress={() => addGames([{ packageName: offer.packageName, label: offer.label }])}
                />
              )}
              <View style={{ height: spacing.sm }} />
              {inKids(offer.packageName) ? (
                <Text style={styles.done}>✓ In Kids apps</Text>
              ) : (
                <PrimaryButton title="Add to Kids apps" variant="outline" onPress={() => addToKids(offer.packageName)} />
              )}

              <Pressable onPress={next} style={styles.skip} hitSlop={8}>
                <Text style={styles.skipText}>{inGames(offer) || inKids(offer.packageName) ? 'Done' : 'Skip'}</Text>
              </Pressable>
              {offer.source === 'new' && (
                <Pressable
                  onPress={() => {
                    AsyncStorage.setItem(ASK_NEW_KEY, '0').catch(() => {});
                    setQueue(prev => prev.filter(o => o.source !== 'new'));
                  }}
                  hitSlop={8}>
                  <Text style={styles.never}>Don’t ask about new apps</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      </Modal>

      <AppPickerModal
        visible={picking}
        initialSelected={addedGames.map(a => a.packageName)}
        title="Add games"
        subtitle="Pick apps to show in Games. Apps Android already tags as games are there anyway."
        onClose={() => setPicking(false)}
        onSave={savePicked}
      />
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 20,
  },
  eyebrow: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  appRow: { flexDirection: 'row', alignItems: 'center', marginVertical: spacing.lg },
  label: { color: colors.text, fontSize: 20, fontWeight: '800', marginLeft: spacing.md, flex: 1 },
  done: { color: colors.accent, fontSize: 15, fontWeight: '700', textAlign: 'center', paddingVertical: 12 },
  skip: { marginTop: spacing.md, alignItems: 'center' },
  skipText: { color: colors.text, fontSize: 15, fontWeight: '700' },
  never: { color: colors.textDim, fontSize: 12, textAlign: 'center', marginTop: spacing.md },
});
