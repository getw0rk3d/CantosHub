package com.cantoshub

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Safety net: if the app was killed mid-boost, restore any settings we changed
 * after the device reboots. Both reverts are idempotent (no-op when there's
 * nothing recorded to undo).
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action == Intent.ACTION_BOOT_COMPLETED) {
      try { BoostActions.revert(context) } catch (e: Exception) { }
      try { ShizukuActions.revert(context) { } } catch (e: Exception) { }
    }
  }
}
