# CantosHub 🎮⚡

A standalone, **100% no-root** game-boost hub for Android. CantosHub never uses
`su`. Instead, the *owner* grants ordinary Android special-access permissions, and
a foreground service uses them to apply a "boost" while you game — then restores
everything when you stop.

> This is a separate app from CantosTV / the TV app — its own repo, its own
> package (`com.cantoshub`), its own release cadence.

## What it does (Phase 0)

A boost is just a bundle of toggles the system actually honours:

| Toggle | Mechanism | Permission used |
|---|---|---|
| **Do Not Disturb** | `NotificationManager.setInterruptionFilter` | DND access |
| **Peak refresh rate** | `peak_refresh_rate` / `min_refresh_rate` settings (best-effort) | Write Settings |
| **Keep screen awake** | raises `SCREEN_OFF_TIMEOUT` | Write Settings |
| **Max brightness** | manual brightness mode + max level | Write Settings |
| **Live telemetry** | battery, thermal status, RAM, foreground app | Usage Access (foreground app only) |

The work runs inside a **foreground service** (persistent notification + `START_STICKY`)
— the legitimate, owner-visible way to keep running in the background. Original
values are snapshotted and restored when the boost stops.

### The "no-root, owner-grants-access" model

Everything is gated behind a permission you toggle in system Settings and can
revoke any time. Open the **Access** tab to grant:

- Notifications · Do Not Disturb access · Modify system settings ·
  Usage access · Ignore battery optimizations · Display over other apps

Nothing happens without your grant — no silent control, no blocking of other apps.

## Project layout

```
App.tsx                      # tab shell (Boost / Profiles / Access)
src/
  theme.ts                   # palette + helpers
  native/CantosHub.ts        # typed bridge wrapper (mocks if native absent)
  state/store.tsx            # profiles / permissions / boost state (context)
  components/ui.tsx          # shared UI bits
  screens/                   # DashboardScreen, ProfilesScreen, PermissionsScreen
android/app/src/main/java/com/cantoshub/
  CantosHubModule.kt         # RN bridge: permissions, telemetry, boost control
  CantosHubPackage.kt        # registers the module
  BoostService.kt            # foreground service
  BoostActions.kt            # apply / revert device tweaks (+ snapshot)
```

## Build & run

```bash
npm install
npx react-native run-android      # device or emulator
```

First launch: open **Access** and grant the permissions. Then **Boost** → Start.

## Roadmap

- **Phase 0 (this scaffold)** — permission-driven boost + profiles + telemetry. No root.
- **Phase 1 — Shizuku tier** (still no root): owner authorizes once over wireless
  debugging → ADB-level powers: per-game resolution/DPI downscale, freeze chosen
  background apps, broader settings control.
- **Phase 2** — auto-apply profiles by foreground game (UsageStats watcher in the
  service), live FPS/temp overlay (`SYSTEM_ALERT_WINDOW`).
- **Phase 3** — game launcher/library, per-game stats, boot persistence.

## GitHub

This folder is its own git repo. To publish (e.g. under the same account as the
other Cantos repos):

```bash
# create an empty CantosHub repo on GitHub first, then:
git remote add origin https://github.com/<account>/CantosHub.git
git push -u origin main
```
