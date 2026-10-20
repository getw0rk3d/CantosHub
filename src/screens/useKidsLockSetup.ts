/**
 * Guided setup for "CantosHub Kids lock" (the accessibility helper). Opens the right
 * Settings page at each step and, when the parent comes back, checks what happened
 * and moves on — so nobody has to hunt through Settings:
 *   1. the Kids lock switch itself
 *   2. if Android blocked it ("Restricted setting"): App info → ⋮ → Allow restricted settings
 *   3. back to the switch once that's allowed
 */
import { useEffect, useRef } from 'react';
import { Alert, AppState } from 'react-native';
import { CantosHub } from '../native/CantosHub';

type Step = null | 'switch' | 'restricted';

type StepRef = { current: Step };

const openSwitch = (step: StepRef) => {
  step.current = 'switch';
  CantosHub.openAccessibilitySettings();
};

const openAppInfo = (step: StepRef) => {
  step.current = 'restricted';
  CantosHub.openPermissionSettings('appDetails');
};

const askRestricted = (step: StepRef) =>
  Alert.alert(
    'Step 2 of 3 · Allow it',
    'Android blocks this switch for apps installed outside the Play Store.\n\nOn the next screen tap ⋮ (top right) → Allow restricted settings, and confirm with your fingerprint or PIN. Then come back here.',
    [
      { text: 'Not now', style: 'cancel', onPress: () => (step.current = null) },
      { text: 'Open App info', onPress: () => openAppInfo(step) },
    ],
  );

export function useKidsLockSetup(onChanged: () => void) {
  const step = useRef<Step>(null);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async s => {
      if (s !== 'active' || step.current === null) return;
      const cfg = await CantosHub.kidsGetConfig();
      onChanged();
      const was = step.current;
      step.current = null;
      if (cfg.a11yLock) {
        Alert.alert('Kids lock is on ✓', 'Kids Mode now fully locks the phone, even on mobile data.');
      } else if (cfg.restricted === 'allowed') {
        Alert.alert(
          was === 'restricted' ? 'Step 3 of 3 · Turn it on' : 'Kids lock is still off',
          'Turn on the CantosHub Kids lock switch on the next screen, then tap Allow.',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open', onPress: () => openSwitch(step) },
          ],
        );
      } else {
        askRestricted(step);
      }
    });
    return () => sub.remove();
  }, [onChanged]);

  /** Start (or restart) the guide. */
  return () =>
    Alert.alert(
      'Step 1 of 3 · Turn on Kids lock',
      'On the next screen turn on CantosHub Kids lock and tap Allow.\n\nIf Android says “Restricted setting”, just tap OK and come back — CantosHub will show you the next step.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: () => openSwitch(step) },
      ],
    );
}
