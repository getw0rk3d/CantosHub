/**
 * Games library — lists installed games (Android's game category), shows weekly
 * playtime, launches them, and binds each to a boost profile in one tap.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Badge, PrimaryButton, SectionCard } from '../components/ui';
import { CantosHub, GameInfo, GameStat, ShortcutSpec } from '../native/CantosHub';
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

// Cache icons across renders/tabs so we fetch each app's icon at most once.
const iconCache = new Map<string, string | null>();

function AppIcon({ packageName, label }: { packageName: string; label: string }) {
  const [uri, setUri] = useState<string | null>(iconCache.get(packageName) ?? null);

  useEffect(() => {
    if (iconCache.has(packageName)) {
      setUri(iconCache.get(packageName) ?? null);
      return;
    }
    let cancelled = false;
    CantosHub.getAppIcon(packageName).then(u => {
      iconCache.set(packageName, u);
      if (!cancelled) setUri(u);
    });
    return () => {
      cancelled = true;
    };
  }, [packageName]);

  if (uri) {
    return <Image source={{ uri }} style={styles.avatar} resizeMode="cover" />;
  }
  return (
    <View style={[styles.avatar, { backgroundColor: avatarColor(packageName) }]}>
      <Text style={styles.avatarText}>{label.charAt(0).toUpperCase()}</Text>
    </View>
  );
}

export default function LibraryScreen({ onGoPermissions }: { onGoPermissions: () => void }) {
  const store = useStore();
  const [games, setGames] = useState<GameInfo[]>([]);
  const [stats, setStats] = useState<Record<string, GameStat>>({});
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [assignFor, setAssignFor] = useState<GameInfo | null>(null);
  const [moreFor, setMoreFor] = useState<GameInfo | null>(null);
  const [folderFor, setFolderFor] = useState<GameInfo | null>(null);
  const [selectedFolder, setSelectedFolder] = useState<string>('all');
  const [newFolder, setNewFolder] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);

  const load = useCallback(async (all: boolean) => {
    setLoading(true);
    try {
      CantosHub.getGameStats().then(setStats).catch(() => {});
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

  // Keep the app-icon long-press shortcuts in sync with bound games.
  useEffect(() => {
    const specs: ShortcutSpec[] = store.profiles
      .filter(p => p.packageName)
      .slice(0, 4)
      .map(p => ({
        id: `boost_${p.packageName}`,
        label: games.find(g => g.packageName === p.packageName)?.label || p.name,
        packageName: p.packageName as string,
        profile: p,
      }));
    CantosHub.setGameShortcuts(specs).catch(() => {});
  }, [store.profiles, games]);

  const sorted = [...games].sort(
    (a, b) => b.totalTimeMs - a.totalTimeMs || a.label.localeCompare(b.label),
  );
  const folder = store.folders.find(f => f.id === selectedFolder);
  const visible = folder ? sorted.filter(g => folder.packages.includes(g.packageName)) : sorted;
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

        {!showAll && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chips}
            contentContainerStyle={styles.chipsRow}>
            <Chip
              label="All"
              active={selectedFolder === 'all'}
              onPress={() => setSelectedFolder('all')}
            />
            {store.folders.map(f => (
              <Chip
                key={f.id}
                label={`${f.name} (${f.packages.length})`}
                active={selectedFolder === f.id}
                onPress={() => setSelectedFolder(f.id)}
                onLongPress={() =>
                  Alert.alert('Delete folder?', `Remove "${f.name}"?`, [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Delete',
                      style: 'destructive',
                      onPress: () => {
                        store.deleteFolder(f.id);
                        if (selectedFolder === f.id) setSelectedFolder('all');
                      },
                    },
                  ])
                }
              />
            ))}
            <Chip label="+ New" active={false} onPress={() => setCreatingFolder(true)} />
          </ScrollView>
        )}

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
        ) : visible.length === 0 ? (
          <SectionCard>
            <Text style={styles.empty}>
              {folder
                ? 'No games in this folder yet — add some from a game’s “More” menu.'
                : 'No games detected. Apps are tagged as games via their manifest — emulators often have none.'}
            </Text>
            {!folder && (
              <PrimaryButton
                title="Show all apps"
                variant="outline"
                onPress={() => {
                  setShowAll(true);
                  load(true);
                }}
              />
            )}
          </SectionCard>
        ) : (
          visible.map(g => {
            const profile = store.profiles.find(p => p.packageName === g.packageName);
            const st = stats[g.packageName];
            return (
              <View key={g.packageName} style={styles.gameCard}>
                <View style={styles.gameTop}>
                  <AppIcon packageName={g.packageName} label={g.label} />
                  <View style={styles.gameText}>
                    <Text style={styles.gameLabel} numberOfLines={1}>
                      {g.label}
                    </Text>
                    <Text style={styles.gameMeta}>Playtime (7d): {fmtTime(g.totalTimeMs)}</Text>
                    {!!st && st.sessions > 0 && (
                      <Text style={styles.gameMeta}>
                        {st.sessions} boost{st.sessions === 1 ? '' : 's'}
                        {st.avgFps > 0 ? ` · ~${st.avgFps} fps avg` : ''}
                      </Text>
                    )}
                    <Text style={[styles.gameMeta, profile ? styles.boundOn : null]}>
                      {profile ? `Profile: ${profile.name}` : 'No profile bound'}
                    </Text>
                  </View>
                </View>
                <View style={styles.gameActions}>
                  <View style={styles.gameBtn}>
                    {profile ? (
                      <PrimaryButton
                        title="Boost & Play"
                        onPress={async () => {
                          await store.boostGame(profile);
                          await CantosHub.launchApp(g.packageName);
                        }}
                      />
                    ) : (
                      <PrimaryButton
                        title="Launch"
                        onPress={() => CantosHub.launchApp(g.packageName)}
                      />
                    )}
                  </View>
                  <View style={styles.gameBtn}>
                    <PrimaryButton title="More" variant="outline" onPress={() => setMoreFor(g)} />
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

      {/* Per-game "More" actions */}
      <Modal visible={!!moreFor} transparent animationType="slide" onRequestClose={() => setMoreFor(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setMoreFor(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <Text style={styles.modalTitle}>{moreFor?.label}</Text>
            <Text style={styles.modalSub}>{moreFor?.packageName}</Text>
            <MoreItem
              label="Assign profile"
              onPress={() => {
                const g = moreFor;
                setMoreFor(null);
                setAssignFor(g);
              }}
            />
            <MoreItem
              label="Add to folder"
              onPress={() => {
                const g = moreFor;
                setMoreFor(null);
                setFolderFor(g);
              }}
            />
            <MoreItem
              label="Pin “Boost & Play” to home screen"
              onPress={async () => {
                const g = moreFor;
                setMoreFor(null);
                if (!g) return;
                const p =
                  store.profiles.find(x => x.packageName === g.packageName) ?? store.activeProfile;
                const ok = await CantosHub.pinGameShortcut({
                  id: `boost_${g.packageName}`,
                  label: g.label,
                  packageName: g.packageName,
                  profile: p,
                });
                if (!ok) {
                  Alert.alert('Not supported', 'Your launcher didn’t accept the pin request.');
                }
              }}
            />
            <MoreItem
              label="Set as Quick-tile favorite"
              onPress={async () => {
                const g = moreFor;
                setMoreFor(null);
                if (!g) return;
                const p =
                  store.profiles.find(x => x.packageName === g.packageName) ?? store.activeProfile;
                await CantosHub.setQuickTileProfile(p);
                await CantosHub.requestAddTile();
              }}
            />
            <MoreItem
              label="Uninstall game"
              danger
              onPress={() => {
                const g = moreFor;
                setMoreFor(null);
                if (!g) return;
                Alert.alert('Uninstall', `Uninstall ${g.label}?`, [
                  { text: 'Cancel', style: 'cancel' },
                  {
                    text: 'Uninstall',
                    style: 'destructive',
                    onPress: () => CantosHub.uninstallApp(g.packageName),
                  },
                ]);
              }}
            />
            <View style={{ marginTop: spacing.sm }}>
              <PrimaryButton title="Close" variant="outline" onPress={() => setMoreFor(null)} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Add-to-folder picker */}
      <Modal visible={!!folderFor} transparent animationType="slide" onRequestClose={() => setFolderFor(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>Add to folder</Text>
            <Text style={styles.modalSub}>{folderFor?.label}</Text>
            <FlatList
              data={store.folders}
              keyExtractor={f => f.id}
              style={styles.modalList}
              ListEmptyComponent={
                <Text style={styles.modalSub}>No folders yet — create one below.</Text>
              }
              renderItem={({ item }) => {
                const inF = !!folderFor && item.packages.includes(folderFor.packageName);
                return (
                  <Pressable
                    style={styles.profRow}
                    onPress={() =>
                      folderFor && store.toggleGameInFolder(item.id, folderFor.packageName)
                    }>
                    <Text style={styles.profName}>{item.name}</Text>
                    <View style={[styles.check, inF && styles.checkOn]}>
                      {inF && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                  </Pressable>
                );
              }}
            />
            <View style={styles.modalActions}>
              <View style={styles.modalBtn}>
                <PrimaryButton
                  title="New folder"
                  variant="outline"
                  onPress={() => {
                    setFolderFor(null);
                    setCreatingFolder(true);
                  }}
                />
              </View>
              <View style={styles.modalBtn}>
                <PrimaryButton title="Done" onPress={() => setFolderFor(null)} />
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* New folder */}
      <Modal
        visible={creatingFolder}
        transparent
        animationType="fade"
        onRequestClose={() => setCreatingFolder(false)}>
        <View style={[styles.modalBackdrop, styles.centerBackdrop]}>
          <View style={styles.modalSheet}>
            <Text style={styles.modalTitle}>New folder</Text>
            <TextInput
              value={newFolder}
              onChangeText={setNewFolder}
              placeholder="e.g. Shooters, RPGs…"
              placeholderTextColor={colors.textDim}
              style={styles.input}
            />
            <View style={styles.modalActions}>
              <View style={styles.modalBtn}>
                <PrimaryButton
                  title="Cancel"
                  variant="outline"
                  onPress={() => {
                    setCreatingFolder(false);
                    setNewFolder('');
                  }}
                />
              </View>
              <View style={styles.modalBtn}>
                <PrimaryButton
                  title="Create"
                  onPress={() => {
                    const id = store.addFolder(newFolder);
                    setSelectedFolder(id);
                    setNewFolder('');
                    setCreatingFolder(false);
                  }}
                />
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function Chip({
  label,
  active,
  onPress,
  onLongPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.chip, active && styles.chipOn]}>
      <Text style={[styles.chipText, active && styles.chipTextOn]}>{label}</Text>
    </Pressable>
  );
}

function MoreItem({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable style={styles.moreItem} onPress={onPress} android_ripple={{ color: colors.border }}>
      <Text style={[styles.moreItemText, danger ? { color: colors.danger } : null]}>{label}</Text>
    </Pressable>
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
  centerBackdrop: { justifyContent: 'center', padding: spacing.xl },
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

  chips: { marginBottom: spacing.md },
  chipsRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  chipTextOn: { color: '#06140F' },

  moreItem: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
  moreItemText: { color: colors.text, fontSize: 15 },

  check: {
    width: 26,
    height: 26,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: '#06140F', fontWeight: '900' },

  input: {
    backgroundColor: colors.cardAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginTop: spacing.md,
  },
});
