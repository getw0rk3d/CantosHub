/**
 * Release notes shown in the "What's new" dialog after an update installs.
 * Keyed by versionName. Bundled in-app so it works offline and always matches
 * the installed build.
 */
export const CHANGELOG: Record<string, string> = {
  '1.3.2':
    '• NEW: guided setup (Access tab). One tap walks through every permission: CantosHub opens the right Settings screen, says which switch to turn on and checks it when you come back.' +
    '\n• Kids Mode no longer needs Shizuku for the Home button: Android asks you to make the kids screen your Home app, and after you unlock CantosHub opens the Default home app list so you switch back with one tap.' +
    '\n• Hide games without Shizuku: CantosHub opens your Home screen’s own Hide apps setting.' +
    '\n• Features that only work with Shizuku are now clearly marked PRO.',
  '1.3.1':
    '• Fixed: in the Kids apps / Freeze apps picker, tapping an app while the keyboard was open (after searching) just closed the keyboard instead of selecting it. One tap now selects.' +
    '\n• Kids Mode: the Samsung Wallet swipe-up from the bottom no longer pops up the card while Kids Mode is on (it comes back when you unlock).' +
    '\n• Fixed: CantosHub could stay stuck as the Home screen after Kids Mode (e.g. after a restart), so the app wouldn’t leave or close. It now cleans itself up.' +
    '\n• Fixed: the “Ask a grown-up” screen could stay stuck so “Back to my apps” did nothing.' +
    '\n• NEW: Kids lock (Kids tab) — a strong Kids Mode lock that needs no Shizuku, so it works on mobile data too. It closes the notification shade and the Wallet card and always brings your kid back. Tap Turn on Kids lock and CantosHub opens each Settings screen for you, step by step.' +
    '\n• NEW: quick ways to add apps — CantosHub asks about apps you just installed (Add to Games / Kids apps), you can Share an app from the Play Store or Galaxy Store to CantosHub, and long-pressing the CantosHub icon now has Add game.',
  '1.3.0':
    '• NEW: Kids Mode (Kids tab). Pick any apps, set a PIN, and the phone is locked to just those apps — anything else is covered and your kid is sent back. Calls always come through. With Shizuku it also disables the notification shade and Recents and makes the kids screen the Home screen. Forgot the PIN? Your phone’s own lock screen unlocks it.',
  '1.2.4':
    '• Reliability fixes: reopening the app (or the Boost tab) no longer restarts a running boost and re-runs Free RAM; if Android restarts the boost it resumes your mode instead of killing apps; Quick tile and home-screen shortcuts now apply Shizuku tweaks too; profile edits apply live in Auto mode; the overlay HUD no longer blocks taps in games; stopping a boost restores your exact resolution (Samsung FHD+ stays FHD+) and only undoes what the boost changed.',
  '1.2.3':
    '• Big smoothness fix — CantosHub should no longer cause in-game lag/stutter. It now detects your game reliably (an ad, sign-in popup, or notification could previously make it think you left and re-run the boost mid-game), frees RAM only once per game (targeted, not a 150-app sweep), stopped locking the refresh rate, and moved start-up work off the main thread.',
  '1.2.2':
    '• Fixed: a phone call during a boost (in Auto mode) could leave your volume stuck and mute game audio. CantosHub now holds the boost steady through calls and never touches call-critical apps.',
  '1.2.1':
    '• Block Samsung Game Booster now also covers the Game Launcher, and the card lists exactly which Samsung components it disables. (Your GPU game driver is deliberately left alone.)',
  '1.2.0':
    '• Block Samsung Game Booster (Shizuku) — stop Samsung from throttling your games and hide its pop-up panel so CantosHub is in charge. Fully reversible. (Samsung phones)',
  '1.1.0':
    '• In-app Shizuku setup — live status, a one-tap shortcut to Wireless Debugging, and the full guide right inside the app (Access → Set up Shizuku). Fully in-app pairing (no separate app) is on the way.',
  '1.0.9':
    '• Bug fixes: no more Wi-Fi-lock or overlay leak when starting a boost while one is already running; hardened Shizuku command threading',
  '1.0.8':
    '• Hide games from your phone’s app drawer (Shizuku, no root) — they stay tucked inside CantosHub and re-enable when you play',
  '1.0.7':
    '• Quick Settings tile + home-screen & app-icon shortcuts to boost a game in one tap\n• Game folders to sort your library\n• Uninstall a game from its “More” menu\n• Stop the boost right from its notification',
  '1.0.6':
    '• Boost & Play — one tap in the Games tab launches a game and starts its profile’s boost together',
  '1.0.5':
    '• Auto Free RAM when a game launches in Auto mode\n• Wi-Fi low-latency lock during boost — steadier online play\n• Access tab now refreshes itself after you grant a permission',
  '1.0.4':
    '• Free RAM — kill background apps for more headroom (no root)\n• Clear cache (system-wide with Shizuku)\n• Per-game stats — boost count and average FPS in the Games tab\n• "What\'s new" after an update',
  '1.0.3': '• New CantosHub app icon & branding',
  '1.0.2':
    '• In-app updater — installs new releases in place\n• Live FPS in the overlay (Shizuku)',
  '1.0.1': '• Real app icons in the Games library',
};
