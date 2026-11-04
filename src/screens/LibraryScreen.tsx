/**
 * Games library — lists installed games (Android's game category), shows weekly
 * playtime, launches them, and binds each to a boost profile in one tap.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
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
import { CantosHub, GameInfo, GameStat, HomeHideInfo, ShortcutSpec } from '../native/CantosHub';
import { askHideMode, confirmAsync, homeHideGuide, nameList } from './homeHide';
import { useStore } from '../state/store';
import { colors, radius, spacing } from '../theme';

const PAGE = 40;

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
  // Rows drawn so far. ALL APPS drew every app at once, each asking for its icon, and the
  // icon requests queued ahead of Play / launch on the native side; now more come as you scroll.
  const [limit, setLimit] = useState(PAGE);
  useEffect(() => setLimit(PAGE), [showAll, selectedFolder]);

  const addedPkgs = store.addedGames.map(a => a.packageName);
  const addedKey = addedPkgs.join(',');
  const { refreshHiddenOut, unmarkHomeHidden } = store;
  const homeRef = useRef(store.homeHidden);
  homeRef.current = store.homeHidden;
  const load = useCallback(async (all: boolean) => {
    setLoading(true);
    try {
      CantosHub.getGameStats().then(setStats).catch(() => {});
      // Apps hidden on the Home screen that were uninstalled since: stop listing them as hidden.
      if (homeRef.current.length) {
        CantosHub.listInstalledApps()
          .then(list => {
            if (!list.length) return; // never trust an empty answer with everything
            const installed = new Set(list.map(a => a.packageName));
            unmarkHomeHidden(homeRef.current.filter(h => !installed.has(h.packageName)).map(h => h.packageName));
          })
          .catch(() => {});
      }
      await refreshHiddenOut(); // before the list: hidden games opened from here look installed
      if (all) {
        const apps = await CantosHub.listInstalledApps();
        setGames(apps.map(a => ({ ...a, totalTimeMs: 0 })));
      } else {
        setGames(await CantosHub.listGames(addedKey ? addedKey.split(',') : []));
      }
    } finally {
      setLoading(false);
    }
  }, [addedKey, refreshHiddenOut, unmarkHomeHidden]);

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
  // CantosHub (e.g. its App info Enable button): stop calling it hidden. Not one opened from
  // here: that's switched on only until it closes.
  const { forgetHidden } = store;
  useEffect(() => {
    if (loading || showAll) return;
    const visible = new Set(games.filter(g => !g.hidden).map(g => g.packageName));
    const out = new Set(store.hiddenOut);
    forgetHidden(
      store.hiddenGames
        .filter(h => visible.has(h.packageName) && !out.has(h.packageName))
        .map(h => h.packageName),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, loading, showAll]);

  // Without PRO a hidden (disabled) game comes back through its App info Enable button.
  const unhideOrExplain = async (g: GameInfo): Promise<boolean> => {
    if (store.shizuku?.granted) return (await store.showGames([g.packageName])).length > 0;
    Alert.alert(
      `Show ${g.label} again`,
      'It was hidden with PRO access, which isn’t on right now. On the next screen tap Enable, then come back.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Open', onPress: () => { CantosHub.openAppInfo(g.packageName); } },
      ],
    );
    return false;
  };

  const [hiding, setHiding] = useState(false);
  const hiddenSet = new Set(store.hiddenGames.map(h => h.packageName));
  // Hidden on the Home screen: still switched on, so their notifications keep coming.
  const homeSet = new Set(store.homeHidden.map(h => h.packageName));
  const kidsApps = new Set(store.kids?.allowed ?? []);
  const isHidden = (p: string) => hiddenSet.has(p) || homeSet.has(p);
  // Kids apps stay on the phone: Kids Mode opens them through Android, not through CantosHub.
  const onPhone = games.filter(
    g => !g.hidden && !isHidden(g.packageName) && g.packageName !== 'com.cantoshub' && !kidsApps.has(g.packageName),
  );
  const kidsKept = games.filter(g => !g.hidden && !isHidden(g.packageName) && kidsApps.has(g.packageName)).length;
  // Kids apps hidden from the Kids tab are counted there.
  const homeGames = store.homeHidden.filter(h => !kidsApps.has(h.packageName));
  const hiddenCount = store.hiddenGames.length + homeGames.length;
  const asHidden = (g: { packageName: string; label: string }) => ({ packageName: g.packageName, label: g.label });

  const asleepNote = (list: GameInfo[]) => {
    const n = list.length;
    return `${n === 1 ? `${list[0]?.label ?? '1 game'} is` : `${n} games (${list.slice(0, 2).map(g => g.label).join(', ')}${n > 2 ? '…' : ''}) are`} asleep — Android switches ${n === 1 ? 'it' : 'them'} on when opened, and only the system can change that, so CantosHub can’t switch ${n === 1 ? 'it' : 'them'} off. Your Home screen can hide ${n === 1 ? 'it' : 'them'}, and ${n === 1 ? 'it keeps its' : 'they keep their'} notifications.`;
  };

  /** Hide on the Home screen (switched on, notifications keep coming) and remember them here. */
  const hideOnHome = async (info: HomeHideInfo, list: GameInfo[], intro = '') => {
    if (await homeHideGuide(info, list.map(g => g.label), [], intro)) store.markHomeHidden(list.map(asHidden));
  };

  const hideGamesAsked = async (list: GameInfo[]) => {
    const n = list.length;
    if (!n) return;
    const pro = !!store.shizuku?.granted;
    const info = await CantosHub.homeHideInfo();
    const extra = kidsKept
      ? `${kidsKept === 1 ? '1 Kids app stays' : `${kidsKept} Kids apps stay`} on the phone so Kids Mode can open ${kidsKept === 1 ? 'it' : 'them'}.`
      : '';
    const mode = await askHideMode(n === 1 ? list[0].label : `${n} games`, n > 1, info, pro, extra);
    if (!mode) return;
    if (mode === 'keep') {
      await hideOnHome(info, list);
      return;
    }
    // Switch off (PRO). Asleep games can't be switched off from here; the Home screen can hide them.
    const off = list.filter(g => !g.sleeping);
    const sleepy = list.filter(g => g.sleeping);
    if (off.length) {
      setHiding(true);
      const done = await store.hideGames(off.map(asHidden));
      setHiding(false);
      load(false);
      if (done.length < off.length) {
        Alert.alert(
          off.length === 1 ? 'Could not hide' : 'Some games weren’t hidden',
          off.length === 1
            ? 'PRO access didn’t complete the request. Try again.'
            : `${off.length - done.length} of ${off.length} couldn’t be hidden. Check that PRO access is on and try again.`,
        );
        return;
      }
    }
    if (sleepy.length) await hideOnHome(info, sleepy, asleepNote(sleepy));
  };

  const hideAll = () => hideGamesAsked(onPhone);

  /**
   * Games CantosHub switched off can't send notifications. Switch them back on and hide them
   * on the Home screen instead, so they stay hidden and their notifications come back.
   */
  const notificationsOn = async (list: { packageName: string; label: string }[]) => {
    if (!list.length) return;
    const many = list.length > 1;
    if (!store.shizuku?.granted) {
      Alert.alert(
        'Turn notifications on',
        `${many ? 'They were' : 'It was'} switched off with PRO access, which isn’t on right now. Turn it on (Access tab) and try again, or open App info from ${many ? 'each game’s' : 'the game’s'} More menu and tap Enable.`,
      );
      return;
    }
    const info = await CantosHub.homeHideInfo();
    const names = nameList(list.map(h => h.label));
    const ok = await confirmAsync(
      'Turn notifications on',
      info.kind === 'none'
        ? `${info.label || 'Your Home screen'} can’t hide apps itself, so ${names} will show on your phone again. Android only lets CantosHub hide an app by switching it off, which is what stops its notifications.`
        : `CantosHub switches ${names} back on, then opens your Home screen’s Hide apps so ${many ? 'they stay' : 'it stays'} hidden there. ${many ? 'They keep' : 'It keeps'} opening from CantosHub.`,
      info.kind === 'none' ? 'Switch on' : 'Continue',
    );
    if (!ok) return;
    setHiding(true);
    const done = await store.showGames(list.map(h => h.packageName));
    setHiding(false);
    load(false);
    const back = list.filter(h => done.includes(h.packageName));
    if (back.length && info.kind !== 'none') {
      const backNames = nameList(back.map(h => h.label));
      const intro = `${backNames} ${back.length === 1 ? 'is' : 'are'} switched on again, so notifications are back. Now hide ${back.length === 1 ? 'it' : 'them'} on your Home screen:`;
      if (await homeHideGuide(info, back.map(h => h.label), [], intro)) store.markHomeHidden(back.map(asHidden));
    }
    if (done.length < list.length) {
      Alert.alert('Some are still switched off', `${list.length - done.length} of ${list.length} couldn’t be switched back on. Try again, or use App info → Enable.`);
    }
  };

  /** Show a hidden game on the phone again, however it was hidden. */
  const unhide = async (g: GameInfo) => {
    if (homeSet.has(g.packageName)) {
      const info = await CantosHub.homeHideInfo();
      store.unmarkHomeHidden([g.packageName]);
      await homeHideGuide(info, [], [g.label]);
      return;
    }
    if (await unhideOrExplain(g)) load(false);
  };

  const showAllOnPhone = () => {
    const off = store.hiddenGames.map(h => h.packageName);
    const pro = !!store.shizuku?.granted;
    if (off.length && !pro && !homeGames.length) {
      Alert.alert(
        'Show all games',
        'They were hidden with PRO access, which isn’t on right now. Turn it on (Access tab) and try again, or open each game’s App info from its More menu and tap Enable.',
      );
      return;
    }
    const n = (pro ? off.length : 0) + homeGames.length;
    const stuck = off.length && !pro
      ? `\n\n${off.length === 1 ? '1 game was' : `${off.length} games were`} switched off with PRO access, which isn’t on right now, so ${off.length === 1 ? 'it stays' : 'they stay'} hidden.`
      : '';
    Alert.alert(`Show ${n === 1 ? '1 game' : `${n} games`} on your phone again?`, `They come back to your Home screen and app drawer.${stuck}`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Show',
        onPress: async () => {
          if (off.length && pro) {
            setHiding(true);
            const done = await store.showGames(off);
            setHiding(false);
            load(false);
            if (done.length < off.length) {
              Alert.alert('Some games are still hidden', `${off.length - done.length} of ${off.length} couldn’t be switched back on. Try again, or use App info → Enable.`);
            }
          }
          if (homeGames.length) {
            const info = await CantosHub.homeHideInfo();
            store.unmarkHomeHidden(homeGames.map(h => h.packageName));
            await homeHideGuide(info, [], homeGames.map(h => h.label));
          }
        },
      },
    ]);
  };
  const hiddenAsGames: GameInfo[] = store.hiddenGames
    .filter(h => !games.some(g => g.packageName === h.packageName))
    .map(h => ({ packageName: h.packageName, label: h.label, totalTimeMs: 0 }));
  const sorted = [...games, ...hiddenAsGames].sort(
    (a, b) => b.totalTimeMs - a.totalTimeMs || a.label.localeCompare(b.label),
  );
  const folder = store.folders.find(f => f.id === selectedFolder);
  const visible = folder ? sorted.filter(g => folder.packages.includes(g.packageName)) : sorted;
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
    if (limit < visible.length && contentOffset.y + layoutMeasurement.height > contentSize.height - 800) {
      setLimit(l => l + PAGE);
    }
  };
  const usageOff = !!store.permissions && !store.permissions.usageAccess;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        onScroll={onScroll}
        scrollEventThrottle={250}
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

        {!showAll && !loading && (onPhone.length > 0 || hiddenCount > 0) && (
          <View style={styles.hideBar}>
            <Text style={styles.hideBarText}>
              {hiddenCount
                ? `${hiddenCount === 1 ? '1 game is' : `${hiddenCount} games are`} hidden from your phone and open from here.`
                : 'Keep your games off the Home screen and app drawer — they open from here, and their notifications keep coming.'}
            </Text>
            {store.hiddenGames.length > 0 && (
              <>
                <Text style={[styles.hideBarText, styles.hideBarWarn]}>
                  {store.hiddenGames.length === 1
                    ? `${store.hiddenGames[0].label} is switched off, so it can’t send notifications.`
                    : `${store.hiddenGames.length} hidden games are switched off, so they can’t send notifications.`}
                </Text>
                <View style={styles.hideBarBtn}>
                  <PrimaryButton
                    title="Turn notifications on"
                    busy={hiding}
                    onPress={() => notificationsOn(store.hiddenGames)}
                  />
                </View>
              </>
            )}
            {onPhone.length > 0 && (
              <View style={styles.hideBarBtn}>
                <PrimaryButton
                  title={hiddenCount ? `Hide the other ${onPhone.length}` : `Hide all ${onPhone.length} from phone`}
                  variant="outline"
                  busy={hiding}
                  onPress={hideAll}
                />
              </View>
            )}
            {hiddenCount > 0 && (
              <View style={styles.hideBarBtn}>
                <PrimaryButton title="Show all on phone" variant="outline" busy={hiding} onPress={showAllOnPhone} />
              </View>
            )}
          </View>
        )}

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
            {visible.slice(0, limit).map((g, i) => {
              const profile = store.profiles.find(p => p.packageName === g.packageName);
              const st = stats[g.packageName];
              // Switched off by CantosHub (g.hidden: e.g. hidden in the Kids tab): no notifications.
              const switchedOff = hiddenSet.has(g.packageName) || !!g.hidden;
              // Hidden on the Home screen: still on, opens like any app, notifications keep coming.
              const hidden = switchedOff || homeSet.has(g.packageName);
              const played = fmtTime(g.totalTimeMs);
              const onPlay = async () => {
                // A switched-off game is switched on for this session by launchApp (PRO); without
                // PRO it can only come back through its App info Enable button.
                const out = store.hiddenOut.includes(g.packageName);
                if (switchedOff && !out && !store.shizuku?.granted) {
                  await unhideOrExplain(g);
                  return;
                }
                // Same as the Dashboard: in Auto mode just make sure Auto is watching (a manual
                // boost here used to end Auto while the app still said Auto).
                if (profile && !store.autoMode) await store.boostGame(profile);
                else if (store.autoMode && !store.boostRunning) await store.startBoost();
                const opened = await CantosHub.launchApp(g.packageName);
                if (switchedOff) store.refreshHiddenOut();
                if (!opened && switchedOff) await unhideOrExplain(g);
              };
              return (
                <View key={g.packageName} style={[styles.gameRow, i > 0 && styles.gameRowDivider]}>
                  <AppIcon packageName={g.packageName} label={g.label} size={46} />
                  <View style={styles.gameText}>
                    <View style={styles.labelRow}>
                      <Text style={styles.gameLabel} numberOfLines={1}>
                        {g.label}
                      </Text>
                      {hidden && <Badge text="HIDDEN" color={switchedOff ? colors.warn : colors.accent} />}
                    </View>
                    <Text style={styles.gameMeta} numberOfLines={1}>
                      {switchedOff && <Text style={styles.alertsOff}>Notifications off · </Text>}
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
        onClear={() => {
          if (assignFor) store.unassignGame(assignFor.packageName);
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
            {moreFor && (hiddenSet.has(moreFor.packageName) || moreFor.hidden) && (
              <MoreItem
                label="Turn notifications on"
                onPress={() => {
                  const g = moreFor;
                  setMoreFor(null);
                  if (g) notificationsOn([asHidden(g)]);
                }}
              />
            )}
            {moreFor && (isHidden(moreFor.packageName) || moreFor.hidden) ? (
              <MoreItem
                label="Unhide (show in app drawer)"
                onPress={() => {
                  const g = moreFor;
                  setMoreFor(null);
                  if (g) unhide(g);
                }}
              />
            ) : (
              <MoreItem
                label="Hide from app drawer"
                onPress={() => {
                  const g = moreFor;
                  setMoreFor(null);
                  if (g) hideGamesAsked([g]);
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
  onClear,
}: {
  game: GameInfo | null;
  onClose: () => void;
  onPick: (profileId: string) => void;
  onCreate: () => void;
  /** No profile: the game is played as-is, Auto mode leaves it alone. */
  onClear: () => void;
}) {
  const store = useStore();
  const unbound = !store.profiles.some(p => p.packageName === game?.packageName);
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
            ListHeaderComponent={
              <Pressable style={styles.profRow} onPress={onClear}>
                <View style={styles.noProfText}>
                  <Text style={styles.profName}>No profile</Text>
                  <Text style={styles.noProfSub}>Play it as-is — Auto mode leaves this game alone</Text>
                </View>
                {unbound ? (
                  <Badge text="CURRENT" color={colors.accent} />
                ) : (
                  <Text style={styles.link}>Choose</Text>
                )}
              </Pressable>
            }
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
  noProfText: { flex: 1, paddingRight: spacing.md },
  noProfSub: { color: colors.textDim, fontSize: 12, marginTop: 2 },
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
  hideBar: {
    backgroundColor: colors.card,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  hideBarText: { color: colors.textDim, fontSize: 13, lineHeight: 19 },
  hideBarBtn: { marginTop: spacing.sm },
  hideBarWarn: { color: colors.warn, marginTop: spacing.sm },
  alertsOff: { color: colors.warn, fontWeight: '600' },
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
