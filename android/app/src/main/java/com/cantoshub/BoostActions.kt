package com.cantoshub

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.provider.Settings
import org.json.JSONObject

/**
 * Applies / reverts the actual device tweaks for a boost profile.
 *
 * Everything here is gated behind a permission the *owner* granted
 * (Write Settings / DND access). Nothing requires root. The first time a tweak
 * is applied we snapshot the original values into SharedPreferences so [revert]
 * can faithfully restore them when the boost stops.
 */
object BoostActions {
  private const val PREFS = "cantoshub_snapshot"
  private const val KEY_HAS = "has_snapshot"
  private const val KEY_BRIGHTNESS_MODE = "brightness_mode"
  private const val KEY_BRIGHTNESS = "brightness"
  private const val KEY_TIMEOUT = "screen_off_timeout"
  private const val KEY_DND = "dnd_filter"
  private const val KEY_PEAK = "peak_refresh"
  private const val KEY_MIN = "min_refresh"

  private const val AWAKE_TIMEOUT_MS = 30 * 60 * 1000 // keep screen on up to 30 min
  private const val DEFAULT_TIMEOUT_MS = 60_000

  fun applyProfile(ctx: Context, profile: JSONObject) {
    ensureSnapshot(ctx)
    setDnd(ctx, profile.optBoolean("dnd", false))
    setKeepAwake(ctx, profile.optBoolean("keepAwake", false))
    setMaxBrightness(ctx, profile.optBoolean("maxBrightness", false))
    setPeakRefreshRate(ctx, profile.optBoolean("peakRefreshRate", false))
  }

  fun revert(ctx: Context) {
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!sp.getBoolean(KEY_HAS, false)) return
    val cr = ctx.contentResolver

    try {
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.isNotificationPolicyAccessGranted) {
        nm.setInterruptionFilter(
          sp.getInt(KEY_DND, NotificationManager.INTERRUPTION_FILTER_ALL),
        )
      }
    } catch (_: Exception) {
    }

    if (Settings.System.canWrite(ctx)) {
      try {
        Settings.System.putInt(
          cr,
          Settings.System.SCREEN_BRIGHTNESS_MODE,
          sp.getInt(KEY_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC),
        )
        Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, sp.getInt(KEY_BRIGHTNESS, 128))
        Settings.System.putInt(
          cr,
          Settings.System.SCREEN_OFF_TIMEOUT,
          sp.getInt(KEY_TIMEOUT, DEFAULT_TIMEOUT_MS),
        )
        Settings.System.putFloat(cr, "peak_refresh_rate", sp.getFloat(KEY_PEAK, 0f))
        Settings.System.putFloat(cr, "min_refresh_rate", sp.getFloat(KEY_MIN, 0f))
      } catch (_: Exception) {
      }
    }

    sp.edit().clear().apply()
  }

  fun setDnd(ctx: Context, enable: Boolean): Boolean {
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!nm.isNotificationPolicyAccessGranted) return false
    ensureSnapshot(ctx)
    nm.setInterruptionFilter(
      if (enable) {
        NotificationManager.INTERRUPTION_FILTER_PRIORITY
      } else {
        NotificationManager.INTERRUPTION_FILTER_ALL
      },
    )
    return true
  }

  fun setMaxBrightness(ctx: Context, enable: Boolean): Boolean {
    if (!Settings.System.canWrite(ctx)) return false
    ensureSnapshot(ctx)
    val cr = ctx.contentResolver
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (enable) {
      Settings.System.putInt(
        cr,
        Settings.System.SCREEN_BRIGHTNESS_MODE,
        Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL,
      )
      Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, 255)
    } else {
      Settings.System.putInt(
        cr,
        Settings.System.SCREEN_BRIGHTNESS_MODE,
        sp.getInt(KEY_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC),
      )
      Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, sp.getInt(KEY_BRIGHTNESS, 128))
    }
    return true
  }

  fun setKeepAwake(ctx: Context, enable: Boolean): Boolean {
    if (!Settings.System.canWrite(ctx)) return false
    ensureSnapshot(ctx)
    val cr = ctx.contentResolver
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    Settings.System.putInt(
      cr,
      Settings.System.SCREEN_OFF_TIMEOUT,
      if (enable) AWAKE_TIMEOUT_MS else sp.getInt(KEY_TIMEOUT, DEFAULT_TIMEOUT_MS),
    )
    return true
  }

  /**
   * Best-effort system-wide peak refresh rate via the (non-public) settings keys.
   * The system clamps to the panel's real maximum, so 120 is safe. Device support
   * varies — a later Shizuku tier can do this more robustly.
   */
  fun setPeakRefreshRate(ctx: Context, enable: Boolean): Boolean {
    if (!Settings.System.canWrite(ctx)) return false
    ensureSnapshot(ctx)
    val cr = ctx.contentResolver
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return try {
      if (enable) {
        Settings.System.putFloat(cr, "peak_refresh_rate", 120f)
        Settings.System.putFloat(cr, "min_refresh_rate", 120f)
      } else {
        Settings.System.putFloat(cr, "peak_refresh_rate", sp.getFloat(KEY_PEAK, 60f))
        Settings.System.putFloat(cr, "min_refresh_rate", sp.getFloat(KEY_MIN, 0f))
      }
      true
    } catch (e: Exception) {
      false
    }
  }

  private fun ensureSnapshot(ctx: Context) {
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (sp.getBoolean(KEY_HAS, false)) return
    val cr = ctx.contentResolver
    val e = sp.edit()

    try {
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      e.putInt(
        KEY_DND,
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
          nm.currentInterruptionFilter
        } else {
          NotificationManager.INTERRUPTION_FILTER_ALL
        },
      )
    } catch (_: Exception) {
    }
    try { e.putInt(KEY_BRIGHTNESS_MODE, Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE)) } catch (_: Exception) {}
    try { e.putInt(KEY_BRIGHTNESS, Settings.System.getInt(cr, Settings.System.SCREEN_BRIGHTNESS)) } catch (_: Exception) {}
    try { e.putInt(KEY_TIMEOUT, Settings.System.getInt(cr, Settings.System.SCREEN_OFF_TIMEOUT)) } catch (_: Exception) {}
    try { e.putFloat(KEY_PEAK, Settings.System.getFloat(cr, "peak_refresh_rate")) } catch (_: Exception) {}
    try { e.putFloat(KEY_MIN, Settings.System.getFloat(cr, "min_refresh_rate")) } catch (_: Exception) {}

    e.putBoolean(KEY_HAS, true)
    e.apply()
  }
}
