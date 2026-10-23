/**
 * Games library — lists installed games (Android's game category), shows weekly
 * playtime, launches them, and binds each to a boost profile in one tap.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { AppIcon } from '../components/AppIcon';
import { Icon } from '../components/Icon';
import { Badge, PrimaryButton, SectionCard } from '../components/ui';
import { CantosHub, GameInfo, GameStat, ShortcutSpec } from '../native/CantosHub';
import { useStore } from '../state/store';
import { colors, radius, spacing } from '../theme';

function fmtTime(ms: number): string {
  const m = Math.round(ms / 60000);
  if (m < 1) return '';
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
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

  const addedPkgs = store.addedGames.map(a => a.packageName);
  const addedKey = addedPkgs.join(',');
  const load = useCallback(async (all: boolean) => {
    setLoading(true);
    try {
      CantosHub.getGameStats().then(setStats).catch(() => {});
      if (all) {
        const apps = await CantosHub.listInstalledApps();
        setGames(apps.map(a => ({ ...a, totalTimeMs: 0 })));
      } else {
        setGames(await CantosHub.listGames(addedKey ? addedKey.split(',') : []));
      }
    } finally {
      setLoading(false);
    }
  }, [addedKey]);

  useEffect(() => {
    store.refreshPermissions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // (Re)load when opened and whenever the user's own added games change.
  useEffect(() => {
    load(showAll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load]);

  // Keep the app-icon long-press shortcuts in sync with bound games.
  useEffect(() => {
    const specs: ShortcutSpec[] = store.profiles
      .filter(p => p.packageName)
      .slice(0, 3) // + the static "Add game" shortcut
      .map(p => ({
        id: `boost_${p.packageName}`,
        label: games.find(g => g.packageName === p.packageName)?.label || p.name,
        packageName: p.packageName as string,
        profile: p,
      }));
    CantosHub.setGameShortcuts(specs).catch(() => {});
  }, [store.profiles, games]);

  // Hidden games are disabled in the launcher, so they no longer appear in
  // listGames — fold them back in from our saved list so they live in CantosHub.
  // A hidden game that shows up as installed+launchable again was re-enabled outside
  // CantosHub (e.g. its App info Enable button): stop calling it hidden.
  const { forgetHidden } = store;
  useEffect(() => {
    if (loading || showAll) return;
    const visible = new Set(games.map(g => g.packageName));
    forgetHidden(store.hiddenGames.filter(h => visible.has(h.packageName)).map(h => h.packageName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, loading, showAll]);

  // Without Shizuku a hidden (disabled) game comes back through its App info Enable button.
  const unhideOrExplain = async (g: GameInfo): Promise<boolean> => {
    if (store.shizuku?.granted) return store.unhideGame(g.packageName);
    Alert.alert(
      `Show ${g.label} again`,
      'It was hidden with Shizuku, which isn’t running. On the next screen tap Enable, then come back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open', onPress: () => { CantosHub.openAppInfo(g.packageName); } },
      ],
    );
    return false;
  };

  const hiddenSet = new Set(store.hiddenGames.map(h => h.packageName));
  const hiddenAsGames: GameInfo[] = store.hiddenGames
    .filter(h => !games.some(g => g.packageName === h.packageName))
    .map(h => ({ packageName: h.packageName, label: h.label, totalTimeMs: 0 }));
  const sorted = [...games, ...hiddenAsGames].sort(
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
          <Pressable
            onPress={() => {
              const next = !showAll;
              setShowAll(next);
              load(next);
            }}>
            <Badge text={showAll ? 'ALL APPS ✓' : 'ALL APPS'} color={showAll ? colors.accent : colors.textDim} />
          </Pressable>
        </View>
        <Text style={styles.sub}>
          {showAll
            ? 'Showing every launchable app — use this if a game is missing.'
            : 'Apps Android tags as games, plus ones you added. Missing one? Tap ALL APPS, or long-press the CantosHub icon → Add game.'}
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
          <View style={styles.list}>
            {visible.map((g, i) => {
              const profile = store.profiles.find(p => p.packageName === g.packageName);
              const st = stats[g.packageName];
              const hidden = hiddenSet.has(g.packageName);
              const played = fmtTime(g.totalTimeMs);
              const onPlay = async () => {
                if (hidden && !(await unhideOrExplain(g))) return;
                if (profile) await store.boostGame(profile);
                await CantosHub.launchApp(g.packageName);
              };
              return (
                <View key={g.packageName} style={[styles.gameRow, i > 0 && styles.gameRowDivider]}>
                  <AppIcon packageName={g.packageName} label={g.label} size={46} />
                  <View style={styles.gameText}>
                    <View style={styles.labelRow}>
                      <Text style={styles.gameLabel} numberOfLines={1}>
                        {g.label}
                      </Text>
                      {hidden && <Badge text="HIDDEN" color={colors.warn} />}
                    </View>
                    <Text style={styles.gameMeta} numberOfLines={1}>
                      {played ? `${played} this week` : 'Not played this week'}
                      {' · '}
                      <Text style={profile ? styles.boundOn : null}>{profile ? profile.name : 'no profile'}</Text>
                      {st?.avgFps ? ` · ~${st.avgFps} fps` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={onPlay}
                    style={({ pressed }) => [styles.playBtn, pressed && styles.playBtnPressed]}
                    accessibilityLabel={profile ? `Boost and play ${g.label}` : `Play ${g.label}`}>
                    <Icon name={profile ? 'bolt' : 'play'} size={18} color="#06140F" fill="#06140F" />
                  </Pressable>
                  <Pressable
                    onPress={() => setMoreFor(g)}
                    style={styles.moreBtn}
                    hitSlop={6}
                    accessibilityLabel={`More options for ${g.label}`}>
                    <Icon name="more" size={20} color={colors.textDim} />
                  </Pressable>
                </View>
              );
            })}
          </View>
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
            {moreFor && hiddenSet.has(moreFor.packageName) ? (
              <MoreItem
                label="Unhide (show in app drawer)"
                onPress={async () => {
                  const g = moreFor;
                  setMoreFor(null);
                  if (g) await unhideOrExplain(g);
                }}
              />
            ) : (
              <MoreItem
                label="Hide from app drawer"
                onPress={async () => {
                  const g = moreFor;
                  setMoreFor(null);
                  if (!g) return;
                  if (!store.shizuku?.granted) {
                    // No Shizuku: the launcher hides apps itself. Samsung's One UI Home has it
                    // under its own settings, so open that page and say which row to tap.
                    Alert.alert(
                      `Hide ${g.label}`,
                      'Your Home screen can hide apps itself. On the next screen tap “Hide apps on Home and Apps screens”, select the game and tap Done.\n\nIt still shows here in Games, and Play works as usual.',
                      [
                        { text: 'Cancel', style: 'cancel' },
                        {
                          text: 'Open',
                          onPress: async () => {
                            const where = await CantosHub.openLauncherHideApps();
                            if (!where) {
                              Alert.alert('Not available', 'This launcher can’t hide apps. Hiding from CantosHub directly is PRO (needs Shizuku).');
                            }
                          },
                        },
                      ],
                    );
                    return;
                  }
                  const ok = await store.hideGame({ packageName: g.packageName, label: g.label });
                  if (!ok) {
                    Alert.alert('Could not hide', 'Shizuku didn’t complete the request.');
                  }
                }}
              />
            )}
            {moreFor && addedPkgs.includes(moreFor.packageName) ? (
              <MoreItem
                label="Remove from Games"
                onPress={() => {
                  const g = moreFor;
                  setMoreFor(null);
                  if (g) store.removeAddedGame(g.packageName);
                }}
              />
            ) : (
              showAll && (
                <MoreItem
                  label="Add to Games"
                  onPress={() => {
                    const g = moreFor;
                    setMoreFor(null);
                    if (g) store.addGames([{ packageName: g.packageName, label: g.label }]);
                  }}
                />
              )
            )}
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

  list: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
  },
  gameRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.md },
  gameRowDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  gameText: { flex: 1, marginLeft: spacing.md, marginRight: spacing.sm },
  playBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnPressed: { opacity: 0.7 },
  moreBtn: { width: 32, height: 40, alignItems: 'center', justifyContent: 'center', marginLeft: 4 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gameLabel: { color: colors.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  gameMeta: { color: colors.textDim, fontSize: 12, marginTop: 3 },
  boundOn: { color: colors.accent },

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
