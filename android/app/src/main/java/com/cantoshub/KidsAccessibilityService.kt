package com.cantoshub

import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Rect
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo

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
    private const val SYSTEMUI = "com.android.systemui"

    @Volatile
    var instance: KidsAccessibilityService? = null
      private set

    fun isEnabled(ctx: Context): Boolean {
      val me = ComponentName(ctx, KidsAccessibilityService::class.java)
      val list = Settings.Secure.getString(ctx.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: ""
      return list.split(':').any { ComponentName.unflattenFromString(it) == me }
    }
  }

  private val main = Handler(Looper.getMainLooper())
  private var lastDismiss = 0L

  override fun onServiceConnected() {
    instance = this
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null || !KidsPrefs.isActive(this)) return
    when (event.eventType) {
      AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
        val pkg = event.packageName?.toString()
        if (pkg == WALLET && WALLET !in KidsPrefs.allowed(this)) performGlobalAction(GLOBAL_ACTION_BACK)
        guardShade()
        KidsService.instance?.checkSoon()
      }
      AccessibilityEvent.TYPE_WINDOWS_CHANGED -> guardShade()
    }
  }

  /**
   * Close the notification shade / quick settings if open. Samsung's shade is one
   * full-screen system window. Also called from [KidsService]'s poll, because pulling
   * the shade doesn't always send an event. Skipped on the lock screen (the shade
   * window is also the keyguard there, and the parent's PIN entry must keep working)
   * and during calls.
   */
  fun guardShade() {
    main.post {
      if (!KidsPrefs.isActive(this) || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return@post
      if ((getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked) return@post
      if (KidsService.isCallActive(this) || KidsPrefs.systemAllowed(this)) return@post
      if (!shadeOpen()) return@post
      val now = System.currentTimeMillis()
      if (now - lastDismiss < 250) return@post
      lastDismiss = now
      performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
    }
  }

  private fun shadeOpen(): Boolean = try {
    val screenH = resources.displayMetrics.heightPixels
    val r = Rect()
    windows.any { w ->
      if (w.type != AccessibilityWindowInfo.TYPE_SYSTEM) return@any false
      w.getBoundsInScreen(r)
      if (r.height() < screenH / 2) return@any false
      val root = w.root
      val pkg = root?.packageName?.toString()
      pkg == null || pkg == SYSTEMUI
    }
  } catch (e: Exception) {
    false
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
