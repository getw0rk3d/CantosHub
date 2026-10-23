/**
 * Kids Mode without Shizuku borrows the Home role through Android's prompt. Android does not
 * hand it back by itself when Kids Mode ends (with two launchers it has no default), so after
 * unlocking we open Settings > Default home app, say what to tap, and check it really got
 * saved when the parent comes back - asking again if not.
 */
import { Alert, AppState } from 'react-native';
import { CantosHub } from '../native/CantosHub';

let asking = false;

export async function offerHomeGiveBack(again = false): Promise<void> {
  if (asking) return;
  const cfg = await CantosHub.kidsGetConfig().catch(() => null);
  if (!cfg?.homeRoleTaken) return;
  asking = true;
  Alert.alert(
    again ? 'Home screen still not set' : 'Switch back to your Home screen',
    'Kids Mode borrowed the Home button. On the next screen tap One UI Home (your usual Home screen), then come back.',
    [{
      text: 'OK',
      onPress: () => {
        CantosHub.openHomeChooser();
        const sub = AppState.addEventListener('change', s => {
          if (s !== 'active') return;
          sub.remove();
          asking = false;
          offerHomeGiveBack(true);
        });
      },
    }],
    { cancelable: false },
  );
}
