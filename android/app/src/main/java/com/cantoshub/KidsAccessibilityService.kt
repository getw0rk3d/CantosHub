package com.cantoshub

import android.accessibilityservice.AccessibilityService
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent

/**
 * Optional Kids Mode helper that needs no Shizuku (so it works on mobile data, where
 * Shizuku's wireless debugging can't start). Idle unless Kids Mode is on. It:
 * - tells [KidsService] about every window change right away (no polling delay),
 * - closes the notification shade and Samsung Wallet's swipe-up card,
 * - brings the kids screen back. Android always lets an accessibility service open an
 *   activity, so this works even when a background start would be blocked.
 */
class KidsAccessibilityService : AccessibilityService() {
  companion object {
    private const val WALLET = "com.samsung.android.spay"

    @Volatile
    var instance: KidsAccessibilityService? = null
      private set

    fun isEnabled(ctx: Context): Boolean {
      val me = ComponentName(ctx, KidsAccessibilityService::class.java)
      val list = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
      return list.split(':').any { ComponentName.unflattenFromString(it) == me }
    }
  }

  override fun onServiceConnected() {
    instance = this
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || !KidsPrefs.isActive(this)) return
    if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return
    val pkg = event.packageName?.toString() ?: return
    when {
      pkg == "com.android.systemui" -> {
        // Notification shade / quick settings. Calls stay reachable (full-screen call UI).
        if (!KidsService.isCallActive(this) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
          performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
        }
      }
      pkg == WALLET && WALLET !in KidsPrefs.allowed(this) -> performGlobalAction(GLOBAL_ACTION_BACK)
    }
    KidsService.instance?.checkSoon()
  }

  override fun onInterrupt() {}

  override fun onUnbind(intent: Intent?): Boolean {
    instance = null
    return super.onUnbind(intent)
  }

  override fun onDestroy() {
    instance = null
    super.onDestroy()
  }

  /** Open the kids screen from here (exempt from background-start limits). */
  fun showKidsScreen(): Boolean = try {
    startActivity(
      Intent(this, MainActivity::class.java).addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP,
      ),
    )
    true
  } catch (e: Exception) {
    false
  }
}
