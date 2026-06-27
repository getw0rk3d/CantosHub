/** Per-game / per-mode boost profiles. Pick one as active; edit its toggles. */
import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Badge, PrimaryButton, SectionCard } from '../components/ui';
import { BoostProfile } from '../native/CantosHub';
import { ToggleKey, useStore } from '../state/store';
import { colors, spacing } from '../theme';

const FIELDS: { key: ToggleKey; label: string }[] = [
  { key: 'dnd', label: 'Do Not Disturb' },
  { key: 'peakRefreshRate', label: 'Peak refresh rate' },
  { key: 'keepAwake', label: 'Keep screen awake' },
  { key: 'maxBrightness', label: 'Max brightness' },
];

export default function ProfilesScreen() {
  const store = useStore();
  const [newName, setNewName] = useState('');

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
          onActivate={() => store.setActiveProfileId(p.id)}
          onChange={(key, v) => store.updateProfile(p.id, { [key]: v })}
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
    </ScrollView>
  );
}

function ProfileCard({
  profile,
  active,
  onActivate,
  onChange,
  onDelete,
}: {
  profile: BoostProfile;
  active: boolean;
  onActivate: () => void;
  onChange: (key: ToggleKey, value: boolean) => void;
  onDelete?: () => void;
}) {
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
      {!!onDelete && (
        <Pressable onPress={onDelete} style={styles.delete}>
          <Text style={styles.deleteText}>Delete profile</Text>
        </Pressable>
      )}
    </SectionCard>
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
  delete: { marginTop: spacing.sm, alignSelf: 'flex-start' },
  deleteText: { color: colors.danger, fontSize: 13, fontWeight: '600' },
});
