/**
 * Guided permission setup: walks through every missing permission in order. For each one
 * it says exactly which switch to turn on, opens that Settings screen, and checks it when
 * the user comes back - then offers the next one. No hunting through Settings, and nothing
 * here needs Shizuku.
 */
import { useCallback, useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { CantosHub, PermissionKey, PermissionStatus } from '../native/CantosHub';

export const GUIDE_ORDER: PermissionKey[] = [
  'notifications',
  'usageAccess',
  'overlay',
  'writeSettings',
  'dndAccess',
  'ignoreBatteryOptimizations',
];

export const GUIDE_STEPS: Record<PermissionKey, { label: string; how: string }> = {
  notifications: {
    label: 'Notifications',
    how: 'Turn on “Allow notifications” for CantosHub.',
  },
  usageAccess: {
    label: 'Usage access',
    how: 'Find CantosHub in the list, open it and turn on “Permit usage access”.',
  },
  overlay: {
    label: 'Display over other apps',
    how: 'Find CantosHub in the list and turn on “Allow display over other apps”.',
  },
  writeSettings: {
    label: 'Modify system settings',
    how: 'Find CantosHub in the list and turn on “Allow modifying system settings”.',
  },
  dndAccess: {
    label: 'Do Not Disturb access',
    how: 'Find CantosHub in the list and turn it on, then tap Allow.',
  },
  ignoreBatteryOptimizations: {
    label: 'Battery: unrestricted',
    how: 'Tap Allow (or choose “Unrestricted”) so the boost keeps running in the background.',
  },
};

export function usePermissionGuide(onChanged: () => void) {
  const pending = useRef<PermissionKey | null>(null);

  const missing = (st: PermissionStatus, after?: PermissionKey) => {
    const from = after ? GUIDE_ORDER.indexOf(after) + 1 : 0;
    return GUIDE_ORDER.slice(from).filter(k => !st[k]).concat(after ? GUIDE_ORDER.slice(0, from - 1).filter(k => !st[k]) : []);
  };

  const open = useCallback((k: PermissionKey) => {
    pending.current = k;
    CantosHub.openPermissionSettings(k);
  }, []);

  const explain = useCallback((k: PermissionKey, left: number) => {
    const step = GUIDE_STEPS[k];
    Alert.alert(
      `${step.label}${left > 1 ? `  ·  ${left} left` : ''}`,
      `${step.how}\n\nCantosHub opens the right screen for you — just come back when it’s on.`,
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Open', onPress: () => open(k) },
      ],
    );
  }, [open]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async s => {
      if (s !== 'active' || !pending.current) return;
      const k = pending.current;
      pending.current = null;
      const st = await CantosHub.getPermissionStatus().catch(() => null);
      onChanged();
      if (!st) return;
      if (st[k]) {
        const rest = missing(st, k);
        if (!rest.length) {
          Alert.alert('All set ✓', 'CantosHub has everything it needs. Shizuku stays optional for the PRO extras.');
        } else {
          Alert.alert(`${GUIDE_STEPS[k].label} is on ✓`, `Next: ${GUIDE_STEPS[rest[0]].label}.`, [
            { text: 'Later', style: 'cancel' },
            { text: 'Continue', onPress: () => explain(rest[0], rest.length) },
          ]);
        }
      } else {
        const rest = missing(st, k).filter(x => x !== k);
        Alert.alert(`${GUIDE_STEPS[k].label} is still off`, GUIDE_STEPS[k].how, [
          rest.length
            ? { text: 'Skip', onPress: () => explain(rest[0], rest.length) }
            : { text: 'Later', style: 'cancel' },
          { text: 'Try again', onPress: () => open(k) },
        ]);
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onChanged, explain, open]);

  /** Start (or resume) the guide from the first missing permission. */
  return useCallback(async () => {
    const st = await CantosHub.getPermissionStatus().catch(() => null);
    if (!st) return;
    const rest = missing(st);
    if (!rest.length) {
      Alert.alert('All set ✓', 'Every permission is already on.');
      return;
    }
    explain(rest[0], rest.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [explain]);
}
