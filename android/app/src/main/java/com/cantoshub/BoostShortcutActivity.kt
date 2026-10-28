package com.cantoshub

import android.app.Activity
import android.content.Intent
import android.os.Bundle

/**
 * Invisible trampoline launched by home-screen / app-icon shortcuts: starts a
 * boost with the given profile and (optionally) launches a game, then finishes.
 *
 * Not exported: only CantosHub's own shortcuts reach it (the launcher starts those as
 * CantosHub). Open to every app, it let any of them start a boost with any profile it liked -
 * freezing apps and changing the resolution through CantosHub's Shizuku access. The shortcut
 * carries just a profile id; the profile itself is today's saved copy (QuickPrefs).
 */
class BoostShortcutActivity : Activity() {
  companion object {
    const val EXTRA_PROFILE_ID = "profileId"
    const val EXTRA_PROFILE = "profile" // shortcuts made before 1.3.5 carry a copy of the profile
    const val EXTRA_LAUNCH_PKG = "launchPkg"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val launchPkg = intent?.getStringExtra(EXTRA_LAUNCH_PKG)
    val profile = QuickPrefs.resolve(
      this,
      intent?.getStringExtra(EXTRA_PROFILE_ID),
      intent?.getStringExtra(EXTRA_PROFILE),
      launchPkg,
    )
    try {
      BoostService.startFromOutside(this, profile)
    } catch (e: Exception) {
    }

    if (!launchPkg.isNullOrEmpty()) {
      try {
        packageManager.getLaunchIntentForPackage(launchPkg)?.let {
          it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          startActivity(it)
        }
      } catch (e: Exception) {
      }
    }

    finish()
  }
}
