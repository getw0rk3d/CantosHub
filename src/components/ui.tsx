/** Small shared UI building blocks for CantosHub. */
import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { colors, radius, spacing } from '../theme';

export function SectionCard({
  title,
  children,
  right,
}: {
  title?: string;
  children: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      {(title || right) && (
        <View style={styles.cardHeader}>
          {title ? <Text style={styles.cardTitle}>{title}</Text> : <View />}
          {right}
        </View>
      )}
      {children}
    </View>
  );
}

export function ToggleRow({
  label,
  description,
  value,
  onValueChange,
  locked,
  lockedHint,
  onPressLocked,
}: {
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  locked?: boolean;
  lockedHint?: string;
  onPressLocked?: () => void;
}) {
  return (
    <Pressable
      style={styles.row}
      onPress={locked ? onPressLocked : undefined}
      android_ripple={locked ? { color: colors.border } : undefined}>
      <View style={styles.rowText}>
        <Text style={styles.rowLabel}>{label}</Text>
        {!!description && <Text style={styles.rowDesc}>{description}</Text>}
        {locked && !!lockedHint && (
          <Text style={styles.lockedHint}>🔒 {lockedHint}</Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={locked}
        thumbColor={value ? colors.accent : '#6B7688'}
        trackColor={{ false: '#2A3340', true: 'rgba(0,229,160,0.35)' }}
      />
    </Pressable>
  );
}

export function StatCard({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit?: string;
  accent?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={styles.statValueRow}>
        <Text style={[styles.statValue, accent ? { color: accent } : null]}>
          {value}
        </Text>
        {!!unit && <Text style={styles.statUnit}>{unit}</Text>}
      </View>
    </View>
  );
}

export function PrimaryButton({
  title,
  onPress,
  variant = 'solid',
  busy,
  disabled,
}: {
  title: string;
  onPress: () => void;
  variant?: 'solid' | 'outline' | 'danger';
  busy?: boolean;
  disabled?: boolean;
}) {
  const isOutline = variant === 'outline';
  const isDanger = variant === 'danger';
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || busy}
      android_ripple={{ color: 'rgba(0,0,0,0.2)' }}
      style={[
        styles.btn,
        isOutline && styles.btnOutline,
        isDanger && styles.btnDanger,
        (disabled || busy) && styles.btnDisabled,
      ]}>
      {busy ? (
        <ActivityIndicator color={isOutline ? colors.accent : '#06140F'} />
      ) : (
        <Text
          style={[
            styles.btnText,
            isOutline && styles.btnTextOutline,
            isDanger && styles.btnTextDanger,
          ]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Badge({ text, color }: { text: string; color: string }) {
  return (
    <View style={[styles.badge, { borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{text}</Text>
    </View>
  );
}

export function StatusDot({ ok }: { ok: boolean }) {
  return (
    <View
      style={[
        styles.dot,
        { backgroundColor: ok ? colors.accent : colors.danger },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  rowText: { flex: 1, paddingRight: spacing.md },
  rowLabel: { color: colors.text, fontSize: 15, fontWeight: '600' },
  rowDesc: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  lockedHint: { color: colors.warn, fontSize: 12, marginTop: 4 },
  stat: {
    flex: 1,
    backgroundColor: colors.cardAlt,
    borderRadius: radius.sm,
    padding: spacing.md,
    minWidth: 120,
  },
  statLabel: { color: colors.textDim, fontSize: 12 },
  statValueRow: { flexDirection: 'row', alignItems: 'flex-end', marginTop: 4 },
  statValue: { color: colors.text, fontSize: 22, fontWeight: '800' },
  statUnit: { color: colors.textDim, fontSize: 12, marginLeft: 4, marginBottom: 3 },
  btn: {
    backgroundColor: colors.accent,
    borderRadius: radius.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.accent,
  },
  btnDanger: { backgroundColor: colors.danger },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: '#06140F', fontSize: 16, fontWeight: '800' },
  btnTextOutline: { color: colors.accent },
  btnTextDanger: { color: '#fff' },
  badge: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
