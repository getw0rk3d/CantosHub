/** Per-game / per-mode boost profiles. Pick one as active; edit its toggles. */
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Badge, PrimaryButton, SectionCard } from '../components/ui';
import { BoostProfile, CantosHub, InstalledApp } from '../native/CantosHub';
import { ToggleKey, useStore } from '../state/store';
import { colors, radius, spacing } from '../theme';

const FIELDS: { key: ToggleKey; label: string }[] = [
  { key: 'dnd', label: 'Do Not Disturb' },
  { key: 'peakRefreshRate', label: 'Peak refresh rate' },
  { key: 'keepAwake', label: 'Keep screen awake' },
  { key: 'maxBrightness', label: 'Max brightness' },
];

const RES_OPTIONS: { label: string; value: number }[] = [
  { label: 'Native', value: 1 },
  { label: '90%', value: 0.9 },
  { label: '80%', value: 0.8 },
  { label: '67%', value: 0.67 },
];

export default function ProfilesScreen() {
  const store = useStore();
  const [newName, setNewName] = useState('');
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [gamePickerFor, setGamePickerFor] = useState<string | null>(null);
  const shizukuGranted = !!store.shizuku?.granted;

  useEffect(() => {
    store.refreshShizuku();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickerProfile = store.profiles.find(p => p.id === pickerFor) || null;
  const gameProfile = store.profiles.find(p => p.id === gamePickerFor) || null;

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.title}>Profiles</Text>
      <Text style={styles.sub}>
        Save toggle presets per game or mode. Auto-apply by game comes in a later phase.
      </Text>

      {store.profiles.map(p => (
        <ProfileCard
          key={p.id}
          profile={p}
          active={p.id === store.activeProfileId}
          shizukuGranted={shizukuGranted}
          onActivate={() => store.setActiveProfileId(p.id)}
          onChange={(key, v) => store.updateProfile(p.id, { [key]: v })}
          onResolution={value => store.updateProfile(p.id, { resolutionScale: value })}
          onPickApps={() => setPickerFor(p.id)}
          onPickGame={() => setGamePickerFor(p.id)}
          onDelete={store.profiles.length > 1 ? () => store.deleteProfile(p.id) : undefined}
        />
      ))}

      <SectionCard title="New profile">
        <TextInput
          value={newName}
          onChangeText={setNewName}
          placeholder="e.g. Genshin, COD Mobile…"
          placeholderTextColor={colors.textDim}
          style={styles.input}
        />
        <PrimaryButton
          title="Add profile"
          variant="outline"
          onPress={() => {
            store.addProfile(newName);
            setNewName('');
          }}
        />
      </SectionCard>

      <AppPickerModal
        visible={!!pickerProfile}
        initialSelected={pickerProfile?.freezeApps ?? []}
        onClose={() => setPickerFor(null)}
        onSave={selected => {
          if (pickerFor) store.updateProfile(pickerFor, { freezeApps: selected });
          setPickerFor(null);
        }}
      />

      <AppPickerModal
        visible={!!gameProfile}
        multiSelect={false}
        title="Assign game"
        subtitle="In Auto mode this profile applies when this app is in the foreground."
        initialSelected={gameProfile?.packageName ? [gameProfile.packageName] : []}
        onClose={() => setGamePickerFor(null)}
        onSave={selected => {
          if (gamePickerFor) {
            store.updateProfile(gamePickerFor, { packageName: selected[0] });
          }
          setGamePickerFor(null);
        }}
      />
    </ScrollView>
  );
}

function shortPkg(pkg: string): string {
  const parts = pkg.split('.');
  return parts.length > 1 ? parts.slice(-2).join('.') : pkg;
}

function ProfileCard({
  profile,
  active,
  shizukuGranted,
  onActivate,
  onChange,
  onResolution,
  onPickApps,
  onPickGame,
  onDelete,
}: {
  profile: BoostProfile;
  active: boolean;
  shizukuGranted: boolean;
  onActivate: () => void;
  onChange: (key: ToggleKey, value: boolean) => void;
  onResolution: (value: number) => void;
  onPickApps: () => void;
  onPickGame: () => void;
  onDelete?: () => void;
}) {
  const scale = profile.resolutionScale ?? 1;
  const frozen = profile.freezeApps?.length ?? 0;

  return (
    <SectionCard
      title={profile.name}
      right={
        active ? (
          <Badge text="ACTIVE" color={colors.accent} />
        ) : (
          <Pressable onPress={onActivate}>
            <Text style={styles.link}>Set active</Text>
          </Pressable>
        )
      }>
      {FIELDS.map(f => (
        <View key={f.key} style={styles.fieldRow}>
          <Text style={styles.fieldLabel}>{f.label}</Text>
          <Switch
            value={profile[f.key]}
            onValueChange={v => onChange(f.key, v)}
            thumbColor={profile[f.key] ? colors.accent : '#6B7688'}
            trackColor={{ false: '#2A3340', true: 'rgba(0,229,160,0.35)' }}
          />
        </View>
      ))}

      <Pressable style={styles.fieldRow} onPress={onPickGame}>
        <Text style={styles.fieldLabel}>Game (for Auto)</Text>
        <Text style={styles.link}>
          {profile.packageName ? shortPkg(profile.packageName) : 'Not set'}
        </Text>
      </Pressable>

      {/* Pro tier (Shizuku) */}
      <View style={styles.proHeader}>
        <Text style={styles.proTitle}>PRO · Shizuku</Text>
        {!shizukuGranted && <Text style={styles.proLocked}>Authorize in Access →</Text>}
      </View>

      <View style={[styles.proBlock, !shizukuGranted && styles.disabled]} pointerEvents={shizukuGranted ? 'auto' : 'none'}>
        <Text style={styles.fieldLabel}>Resolution</Text>
        <View style={styles.segment}>
          {RES_OPTIONS.map(opt => {
            const selected = Math.abs(scale - opt.value) < 0.001;
            return (
              <Pressable
                key={opt.label}
                onPress={() => onResolution(opt.value)}
                style={[styles.segItem, selected && styles.segItemOn]}>
                <Text style={[styles.segText, selected && styles.segTextOn]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>

        <Pressable style={styles.freezeRow} onPress={onPickApps}>
          <Text style={styles.fieldLabel}>Freeze background apps</Text>
          <Text style={styles.link}>{frozen > 0 ? `${frozen} selected` : 'Choose'}</Text>
        </Pressable>
      </View>

      {!!onDelete && (
        <Pressable onPress={onDelete} style={styles.delete}>
          <Text style={styles.deleteText}>Delete profile</Text>
        </Pressable>
      )}
    </SectionCard>
  );
}

function AppPickerModal({
  visible,
  initialSelected,
  multiSelect = true,
  title = 'Freeze while gaming',
  subtitle = 'Selected apps are suspended on boost and restored when you stop.',
  onClose,
  onSave,
}: {
  visible: boolean;
  initialSelected: string[];
  multiSelect?: boolean;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onSave: (selected: string[]) => void;
}) {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!visible) return;
    setSelected(new Set(initialSelected));
    setLoading(true);
    CantosHub.listInstalledApps()
      .then(list => setApps(list.sort((a, b) => a.label.localeCompare(b.label))))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const toggle = (pkg: string) => {
    setSelected(prev => {
      if (!multiSelect) {
        return prev.has(pkg) ? new Set() : new Set([pkg]);
      }
      const next = new Set(prev);
      if (next.has(pkg)) next.delete(pkg);
      else next.add(pkg);
      return next;
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>{title}</Text>
          <Text style={styles.modalSub}>{subtitle}</Text>

          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.xl }} />
          ) : (
            <FlatList
              data={apps}
              keyExtractor={item => item.packageName}
              style={styles.modalList}
              renderItem={({ item }) => {
                const on = selected.has(item.packageName);
                return (
                  <Pressable style={styles.appRow} onPress={() => toggle(item.packageName)}>
                    <View style={styles.appText}>
                      <Text style={styles.appLabel}>{item.label}</Text>
                      <Text style={styles.appPkg}>{item.packageName}</Text>
                    </View>
                    <View style={[styles.check, on && styles.checkOn]}>
                      {on && <Text style={styles.checkMark}>✓</Text>}
                    </View>
                  </Pressable>
                );
              }}
              ListEmptyComponent={<Text style={styles.modalSub}>No apps found.</Text>}
            />
          )}

          <View style={styles.modalActions}>
            <View style={styles.modalBtn}>
              <PrimaryButton title="Cancel" variant="outline" onPress={onClose} />
            </View>
            <View style={styles.modalBtn}>
              <PrimaryButton title="Save" onPress={() => onSave(Array.from(selected))} />
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },
  title: { color: colors.text, fontSize: 24, fontWeight: '900' },
  sub: { color: colors.textDim, fontSize: 13, marginTop: 4, marginBottom: spacing.lg },
  fieldRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  fieldLabel: { color: colors.text, fontSize: 15 },
  link: { color: colors.accent2, fontWeight: '700', fontSize: 13 },
  input: {
    backgroundColor: colors.cardAlt,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    marginBottom: spacing.md,
  },
  delete: { marginTop: spacing.md, alignSelf: 'flex-start' },
  deleteText: { color: colors.danger, fontSize: 13, fontWeight: '600' },

  // Pro block
  proHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.md,
  },
  proTitle: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  proLocked: { color: colors.warn, fontSize: 11 },
  proBlock: { marginTop: spacing.sm },
  disabled: { opacity: 0.45 },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    padding: 3,
    marginTop: spacing.sm,
  },
  segItem: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.sm - 2 },
  segItemOn: { backgroundColor: colors.accent },
  segText: { color: colors.textDim, fontSize: 13, fontWeight: '700' },
  segTextOn: { color: '#06140F' },
  freezeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.md,
  },

  // Modal
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    maxHeight: '80%',
  },
  modalTitle: { color: colors.text, fontSize: 18, fontWeight: '800' },
  modalSub: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  modalList: { marginTop: spacing.md },
  appRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  appText: { flex: 1, paddingRight: spacing.md },
  appLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  appPkg: { color: colors.textDim, fontSize: 11, marginTop: 2 },
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
  modalActions: { flexDirection: 'row', marginTop: spacing.md, gap: spacing.md },
  modalBtn: { flex: 1 },
});
