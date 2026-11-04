/**
 * Hiding apps without losing their notifications.
 *
 * Android only lets CantosHub's PRO access (shell level) take an app off the phone by switching
 * it off (pm disable-user). A switched-off app can't run at all: no notifications, no messages
 * syncing in the background, no Play Store updates. Android refuses the gentler ways from the
 * shell ("Shell cannot change component state", pm hide needs MANAGE_USERS).
 *
 * The Home screen's own Hide apps (Samsung One UI Home, Nova, Lawnchair...) only takes the
 * icon away: the app stays on and its notifications keep coming. So "Keep notifications" hides
 * through the Home screen and CantosHub remembers the app as hidden (it still lives in the
 * Games tab and on the kids screen); "Switch off" is the stricter hide from before.
 */
import { Alert } from 'react-native';
import { CantosHub, HomeHideInfo } from '../native/CantosHub';

export type HideMode = 'keep' | 'off';

/** "Roblox", "Roblox and Minecraft", "A, B, C, D, E, F and 3 more". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  const shown = names.slice(0, 6);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${more} more`;
  return `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

const homeName = (info: HomeHideInfo) => info.label || 'Your Home screen';

/** OK / Cancel as a promise. */
export function confirmAsync(title: string, message: string, ok: string): Promise<boolean> {
  return new Promise(resolve => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: ok, onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * How should [what] ("Roblox", "5 games") be hidden? Resolves null on Cancel.
 * - Without PRO only the Home screen can hide apps, so that's the answer (no question).
 * - On a Home screen that can't hide apps only Switch off is left (PRO), and we say what it costs.
 */
export function askHideMode(
  what: string,
  many: boolean,
  info: HomeHideInfo,
  pro: boolean,
  extra = '',
): Promise<HideMode | null> {
  const it = many ? 'them' : 'it';
  const tail = extra ? `\n\n${extra}` : '';
  if (info.kind !== 'none' && !pro) return Promise.resolve('keep');
  return new Promise(resolve => {
    if (info.kind === 'none') {
      if (!pro) {
        Alert.alert(
          `Hide ${what}`,
          `${homeName(info)} can’t hide apps itself, and hiding ${it} from CantosHub needs PRO access (Access tab).`,
          [{ text: 'OK', onPress: () => resolve(null) }],
          { cancelable: true, onDismiss: () => resolve(null) },
        );
        return;
      }
      Alert.alert(
        `Hide ${what}`,
        `${homeName(info)} can’t hide apps itself, so CantosHub can only hide ${it} by switching ${it} off until you play from here. ` +
          `While switched off ${many ? 'they' : 'it'} can’t send notifications and the Play Store won’t update ${it}.` +
          tail,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
          { text: 'Switch off', onPress: () => resolve('off') },
        ],
        { cancelable: true, onDismiss: () => resolve(null) },
      );
      return;
    }
    Alert.alert(
      `Hide ${what}`,
      `Keep notifications (recommended): your Home screen hides the icon and the app stays on, so its notifications, messages and Play Store updates keep coming.\n\n` +
        `Switch off: CantosHub switches ${it} off until you play from here. No notifications or updates while hidden.` +
        tail,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        { text: 'Switch off', onPress: () => resolve('off') },
        { text: 'Keep notifications', onPress: () => resolve('keep') },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

/**
 * Open the Home screen's Hide apps and say which apps to select ([hide]) and unselect
 * ([unhide]). Resolves true once that screen opened. [intro] goes first (why we're here).
 */
export function homeHideGuide(info: HomeHideInfo, hide: string[], unhide: string[] = [], intro = ''): Promise<boolean> {
  if (!hide.length && !unhide.length) return Promise.resolve(false);
  const head = intro ? `${intro}\n\n` : '';
  return new Promise(resolve => {
    if (info.kind === 'none') {
      Alert.alert(
        'Not available',
        `${head}${homeName(info)} can’t hide apps itself.`,
        [{ text: 'OK', onPress: () => resolve(false) }],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
      return;
    }
    const where =
      info.kind === 'samsung'
        ? 'On the next screen tap “Hide apps on Home and Apps screens”'
        : `On the next screen (${homeName(info)} settings) find Hide apps`;
    const steps = [hide.length ? `select ${nameList(hide)}` : '', unhide.length ? `unselect ${nameList(unhide)}` : '']
      .filter(Boolean)
      .join(', then ');
    const why = hide.length
      ? `\n\n${hide.length === 1 ? 'It stays' : 'They stay'} switched on, so ${hide.length === 1 ? 'its' : 'their'} notifications keep coming, and ${hide.length === 1 ? 'it still opens' : 'they still open'} from CantosHub.`
      : '';
    Alert.alert(
      hide.length ? 'Hide on your Home screen' : 'Show on your Home screen',
      `${head}${where}, ${steps} and tap Done.${why}`,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Open',
          onPress: async () => {
            const opened = await CantosHub.openLauncherHideApps();
            if (!opened) Alert.alert('Not available', `${homeName(info)} can’t hide apps.`);
            resolve(!!opened);
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
