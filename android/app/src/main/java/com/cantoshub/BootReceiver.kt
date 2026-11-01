package com.cantoshub

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Safety net: if the app was killed mid-boost, restore any settings we changed
 * after the device reboots - or after CantosHub is updated, which kills it without stopping
 * the boost (DND, brightness, frozen apps... stayed on). Both reverts are idempotent (no-op
 * when there's nothing recorded to undo).
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action
    if (action == Intent.ACTION_BOOT_COMPLETED || action == Intent.ACTION_MY_PACKAGE_REPLACED) {
      try { BoostActions.revert(context) } catch (e: Exception) { }
      try { ShizukuActions.revert(context) { } } catch (e: Exception) { }
      // Kids Mode stays on across a reboot until the parent unlocks it.
      if (KidsPrefs.isActive(context)) {
        try { KidsService.start(context) } catch (e: Exception) { }
      } else {
        // A restart turns the top bar back on by itself (an update doesn't).
        if (action == Intent.ACTION_BOOT_COMPLETED) KidsPrefs.setBarLocked(context, false)
        try { KidsService.releaseSystemLock(context) } catch (e: Exception) { }
      }
    }
  }
}
