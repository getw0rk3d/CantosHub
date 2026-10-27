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
  // Which settings a boost actually changed — revert only touches these, so a
  // brightness you adjusted mid-game (with Max brightness off) isn't yanked back.
  private const val TOUCHED_DND = "touched_dnd"
  private const val TOUCHED_BRIGHTNESS = "touched_brightness"
  private const val TOUCHED_TIMEOUT = "touched_timeout"
  private const val TOUCHED_PEAK = "touched_peak"
  // Snapshots from 1.3.5 on. Older ones without any touched flag predate touched-tracking
  // and restore everything; a new snapshot whose profile touched nothing restores nothing.
  private const val KEY_V2 = "snap_v2"

  private const val AWAKE_TIMEOUT_MS = 30 * 60 * 1000 // keep screen on up to 30 min
  private const val DEFAULT_TIMEOUT_MS = 60_000

  fun applyProfile(ctx: Context, profile: JSONObject) {
    ensureSnapshot(ctx)
    setDnd(ctx, profile.optBoolean("dnd", false))
    setKeepAwake(ctx, profile.optBoolean("keepAwake", false))
    setMaxBrightness(ctx, profile.optBoolean("maxBrightness", false))
    setPeakRefreshRate(ctx, profile.optBoolean("peakRefreshRate", false))
  }

  /**
   * True if this device exposes the AOSP peak_refresh_rate setting. Samsung (One UI)
   * does not — refresh is its own "Motion smoothness" (Adaptive already goes to 120 Hz)
   * and the hidden key can't be written by apps, so the toggle would silently do nothing.
   */
  fun isPeakRefreshSupported(ctx: Context): Boolean = try {
    Settings.System.getString(ctx.contentResolver, "peak_refresh_rate") != null
  } catch (_: Exception) {
    false
  }

  private fun markTouched(ctx: Context, key: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(key, true).apply()
  }

  private fun unmarkTouched(ctx: Context, key: String) {
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove(key).apply()
  }

  /** A boost changed settings that are not restored yet. */
  fun hasSnapshot(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_HAS, false)

  fun revert(ctx: Context) {
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (!sp.getBoolean(KEY_HAS, false)) return
    val cr = ctx.contentResolver

    // Old snapshots (before touched-tracking) have no flags: treat everything as touched.
    val legacy = !sp.getBoolean(KEY_V2, false) &&
      listOf(TOUCHED_DND, TOUCHED_BRIGHTNESS, TOUCHED_TIMEOUT, TOUCHED_PEAK).none { sp.contains(it) }
    fun touched(k: String) = legacy || sp.getBoolean(k, false)

    if (touched(TOUCHED_DND) && sp.contains(KEY_DND)) {
      try {
        val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        // The boost only turns DND on when it was off, so "off" is what to go back to. Writing
        // the saved filter back left DND on for good when a Bedtime schedule had it on at the
        // start (the schedule ends, our copy doesn't).
        val back = if (legacy) sp.getInt(KEY_DND, NotificationManager.INTERRUPTION_FILTER_ALL) else NotificationManager.INTERRUPTION_FILTER_ALL
        if (nm.isNotificationPolicyAccessGranted) nm.setInterruptionFilter(back)
      } catch (_: Exception) {
      }
    }

    if (Settings.System.canWrite(ctx)) {
      if (touched(TOUCHED_BRIGHTNESS)) {
        try {
          if (sp.contains(KEY_BRIGHTNESS_MODE)) Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS_MODE, sp.getInt(KEY_BRIGHTNESS_MODE, 1))
          if (sp.contains(KEY_BRIGHTNESS)) Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, sp.getInt(KEY_BRIGHTNESS, 128))
        } catch (_: Exception) {
        }
      }
      if (touched(TOUCHED_TIMEOUT) && sp.contains(KEY_TIMEOUT)) {
        try { Settings.System.putInt(cr, Settings.System.SCREEN_OFF_TIMEOUT, sp.getInt(KEY_TIMEOUT, DEFAULT_TIMEOUT_MS)) } catch (_: Exception) {}
      }
      // Only restore refresh keys that existed before — writing 0 into a key the device
      // never had could change its refresh behavior.
      if (touched(TOUCHED_PEAK) && sp.contains(KEY_PEAK)) {
        try { Settings.System.putFloat(cr, "peak_refresh_rate", sp.getFloat(KEY_PEAK, 0f)) } catch (_: Exception) {}
      }
    }

    sp.edit().clear().apply()
  }

  /**
   * DND on only if it's off now (the user's own DND or a schedule is left alone), and off
   * only if a boost turned it on - a profile without DND used to switch the user's DND off.
   */
  fun setDnd(ctx: Context, enable: Boolean): Boolean {
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (!nm.isNotificationPolicyAccessGranted) return false
    ensureSnapshot(ctx)
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (enable) {
      if (sp.getBoolean(TOUCHED_DND, false)) return true
      if (nm.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL) return true
      markTouched(ctx, TOUCHED_DND)
      nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
    } else if (sp.getBoolean(TOUCHED_DND, false)) {
      unmarkTouched(ctx, TOUCHED_DND)
      nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_ALL)
    }
    return true
  }

  fun setMaxBrightness(ctx: Context, enable: Boolean): Boolean {
    if (!Settings.System.canWrite(ctx)) return false
    ensureSnapshot(ctx)
    val cr = ctx.contentResolver
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (enable) {
      markTouched(ctx, TOUCHED_BRIGHTNESS)
      Settings.System.putInt(
        cr,
        Settings.System.SCREEN_BRIGHTNESS_MODE,
        Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL,
      )
      Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, 255)
    } else if (sp.getBoolean(TOUCHED_BRIGHTNESS, false)) {
      // Only undo brightness if a boost raised it; otherwise leave the user's level alone.
      Settings.System.putInt(
        cr,
        Settings.System.SCREEN_BRIGHTNESS_MODE,
        sp.getInt(KEY_BRIGHTNESS_MODE, Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC),
      )
      Settings.System.putInt(cr, Settings.System.SCREEN_BRIGHTNESS, sp.getInt(KEY_BRIGHTNESS, 128))
      unmarkTouched(ctx, TOUCHED_BRIGHTNESS) // a level set after this is the user's own
    }
    return true
  }

  fun setKeepAwake(ctx: Context, enable: Boolean): Boolean {
    if (!Settings.System.canWrite(ctx)) return false
    ensureSnapshot(ctx)
    val cr = ctx.contentResolver
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    if (enable) markTouched(ctx, TOUCHED_TIMEOUT) else if (!sp.getBoolean(TOUCHED_TIMEOUT, false)) return true
    if (!enable) unmarkTouched(ctx, TOUCHED_TIMEOUT)
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
    if (!isPeakRefreshSupported(ctx)) return false // e.g. Samsung: never create the key
    ensureSnapshot(ctx)
    val cr = ctx.contentResolver
    val sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    return try {
      // Only raise peak_refresh_rate — do NOT force min_refresh_rate up too. Locking
      // min == peak pins the panel to a fixed rate, which can trigger a disruptive
      // display mode switch (black-frame/hitch) and hurts battery. A higher peak lets
      // the panel go up to it while staying adaptive. Skip the write if unchanged.
      if (!enable && !sp.getBoolean(TOUCHED_PEAK, false)) return true
      if (enable) markTouched(ctx, TOUCHED_PEAK)
      val target = if (enable) 120f else sp.getFloat(KEY_PEAK, 60f)
      val current = try {
        Settings.System.getFloat(cr, "peak_refresh_rate")
      } catch (e: Exception) {
        -1f
      }
      if (current != target) {
        Settings.System.putFloat(cr, "peak_refresh_rate", target)
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
    e.putBoolean(KEY_V2, true)
    e.apply()
  }
}
