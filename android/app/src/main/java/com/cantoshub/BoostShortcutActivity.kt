package com.cantoshub

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.os.Bundle

/**
 * Invisible trampoline launched by home-screen / app-icon shortcuts: starts a
 * boost with the given profile and (optionally) launches a game, then finishes.
 */
class BoostShortcutActivity : Activity() {
  companion object {
    const val EXTRA_PROFILE = "profile"
    const val EXTRA_LAUNCH_PKG = "launchPkg"
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val profile = intent?.getStringExtra(EXTRA_PROFILE)
    val launchPkg = intent?.getStringExtra(EXTRA_LAUNCH_PKG)

    if (!profile.isNullOrEmpty()) {
      val svc = Intent(this, BoostService::class.java).apply {
        action = BoostService.ACTION_START
        putExtra(BoostService.EXTRA_PROFILE, profile)
        putExtra(BoostService.EXTRA_FREERAM, true)
        putExtra(BoostService.EXTRA_OVERLAY, false)
      }
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          startForegroundService(svc)
        } else {
          startService(svc)
        }
      } catch (e: Exception) {
      }
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
