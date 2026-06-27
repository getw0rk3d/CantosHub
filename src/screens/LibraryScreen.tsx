/**
 * Games library — lists installed games (Android's game category), shows weekly
 * playtime, launches them, and binds each to a boost profile in one tap.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Badge, PrimaryButton, SectionCard } from '../components/ui';
import { CantosHub, GameInfo } from '../native/CantosHub';
import { useStore } from '../state/store';
import { colors, radius, spacing } from '../theme';

const AVATAR_COLORS = ['#00E5A0', '#3B82F6', '#FFB020', '#FF4D67', '#A78BFA', '#22D3EE'];

function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) % 1000000007;
  }
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function fmtTime(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return '—';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function LibraryScreen({ onGoPermissions }: { onGoPermissions: () => void }) {
  const store = useStore();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [assignFor, setAssignFor] = useState<GameInfo | null>(null);

  const load = useCallback(async (all: boolean) => {
    setLoading(true);
    try {
      if (all) {
        const apps = await CantosHub.listInstalledApps();
        setGames(apps.map(a => ({ ...a, totalTimeMs: 0 })));
      } else {
        setGames(await CantosHub.listGames());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load(false);
    store.refreshPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = [...games].sort((a, b) => b.totalTimeMs - a.totalTimeMs || a.label.localeCompare(b.label));
  const usageOff = !!store.permissions && !store.permissions.usageAccess;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={() => load(showAll)} tintColor={colors.accent} />
        }>
        <View style={styles.headerRow}>
          <Text style={styles.title}>Games</Text>
          {showAll && <Badge text="ALL APPS" color={colors.textDim} />}
        </View>
        <Text style={styles.sub}>
          {showAll
            ? 'Showing every launchable app.'
            : 'Apps Android tags as games. Bind one to a profile for Auto mode.'}
        </Text>

        {usageOff && (
          <Pressable style={styles.notice} onPress={onGoPermissions}>
            <Text style={styles.noticeText}>
              Grant Usage access to see playtime. Tap to open Permissions.
            </Text>
          </Pressable>
        )}

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
        ) : sorted.length === 0 ? (
          <SectionCard>
            <Text style={styles.empty}>
              No games detected. Apps are tagged as games via their manifest — emulators
              often have none.
            </Text>
            <PrimaryButton
              title="Show all apps"
              variant="outline"
              onPress={() => {
                setShowAll(true);
                load(true);
              }}
            />
          </SectionCard>
        ) : (
          sorted.map(g => {
            const profile = store.profiles.find(p => p.packageName === g.packageName);
            return (
              <View key={g.packageName} style={styles.gameCard}>
                <View style={styles.gameTop}>
                  <View style={[styles.avatar, { backgroundColor: avatarColor(g.packageName) }]}>
                    <Text style={styles.avatarText}>{g.label.charAt(0).toUpperCase()}</Text>
                  </View>
                  <View style={styles.gameText}>
                    <Text style={styles.gameLabel} numberOfLines={1}>
                      {g.label}
                    </Text>
                    <Text style={styles.gameMeta}>Playtime (7d): {fmtTime(g.totalTimeMs)}</Text>
                    <Text style={[styles.gameMeta, profile ? styles.boundOn : null]}>
                      {profile ? `Profile: ${profile.name}` : 'No profile bound'}
                    </Text>
                  </View>
                </View>
                <View style={styles.gameActions}>
                  <View style={styles.gameBtn}>
                    <PrimaryButton title="Launch" onPress={() => CantosHub.launchApp(g.packageName)} />
                  </View>
                  <View style={styles.gameBtn}>
                    <PrimaryButton title="Assign" variant="outline" onPress={() => setAssignFor(g)} />
                  </View>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      <ProfilePickerModal
        game={assignFor}
        onClose={() => setAssignFor(null)}
        onPick={profileId => {
          if (assignFor) store.assignGameToProfile(profileId, assignFor.packageName);
          setAssignFor(null);
        }}
        onCreate={() => {
          if (assignFor) {
            const id = store.addProfile(assignFor.label);
            store.assignGameToProfile(id, assignFor.packageName);
          }
          setAssignFor(null);
        }}
      />
    </View>
  );
}

function ProfilePickerModal({
  game,
  onClose,
  onPick,
  onCreate,
}: {
  game: GameInfo | null;
  onClose: () => void;
  onPick: (profileId: string) => void;
  onCreate: () => void;
}) {
  const store = useStore();
  return (
    <Modal visible={!!game} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Bind “{game?.label}”</Text>
          <Text style={styles.modalSub}>Pick a profile to apply when this game opens.</Text>

          <FlatList
            data={store.profiles}
            keyExtractor={p => p.id}
            style={styles.modalList}
            renderItem={({ item }) => {
              const bound = item.packageName === game?.packageName;
              return (
                <Pressable style={styles.profRow} onPress={() => onPick(item.id)}>
                  <Text style={styles.profName}>{item.name}</Text>
                  {bound ? (
                    <Badge text="CURRENT" color={colors.accent} />
                  ) : (
                    <Text style={styles.link}>Bind</Text>
                  )}
                </Pressable>
              );
            }}
          />

          <View style={styles.modalActions}>
            <View style={styles.modalBtn}>
              <PrimaryButton title="Cancel" variant="outline" onPress={onClose} />
            </View>
            <View style={styles.modalBtn}>
              <PrimaryButton title="New profile" onPress={onCreate} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: colors.text, fontSize: 24, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 4, marginBottom: spacing.lg },
  notice: {
    backgroundColor: 'rgba(255,176,32,0.12)',
    borderColor: colors.warn,
    borderWidth: 1,
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  noticeText: { color: colors.warn, fontSize: 12 },
  empty: { color: colors.textDim, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },

  gameCard: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  gameTop: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#06140F', fontSize: 22, fontWeight: '900' },
  gameText: { flex: 1, marginLeft: spacing.md },
  gameLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
  gameMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  boundOn: { color: colors.accent },
  gameActions: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.md },
  gameBtn: { flex: 1 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '70%',
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  modalSub: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  modalList: { marginTop: spacing.md },
  profRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  profName: { color: colors.text, fontSize: 15, fontWeight: '600' },
  link: { color: colors.accent2, fontWeight: '700', fontSize: 13 },
  modalActions: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.md },
  modalBtn: { flex: 1 },
});
