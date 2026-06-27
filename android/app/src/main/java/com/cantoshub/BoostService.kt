package com.cantoshub

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale

/**
 * Foreground service that holds a boost active — the legitimate, owner-visible
 * way to run in the background (persistent notification + START_STICKY).
 *
 * Two modes:
 *  - MANUAL: apply one profile until stopped.
 *  - AUTO:   watch the foreground app (UsageStats) and apply/revert the matching
 *            per-game profile automatically.
 *
 * In both modes it can drive the overlay HUD and always restores originals on stop.
 */
class BoostService : Service() {
  companion object {
    const val ACTION_START = "com.cantoshub.action.START"
    const val ACTION_START_AUTO = "com.cantoshub.action.START_AUTO"
    const val ACTION_STOP = "com.cantoshub.action.STOP"
    const val EXTRA_PROFILE = "profile"
    const val EXTRA_PROFILES = "profiles"
    const val EXTRA_OVERLAY = "overlay"
    private const val CHANNEL_ID = "cantoshub_boost"
    private const val NOTIF_ID = 7341
    private const val POLL_MS = 2500L

    @Volatile
    var isRunning = false
      private set
  }

  private var workThread: HandlerThread? = null
  private var workHandler: Handler? = null
  private var overlay: OverlayHud? = null

  private var showOverlay = false
  private var auto = false
  private var profiles: List<JSONObject> = emptyList()
  private var appliedPackage: String? = null
  private var appliedProfileName: String = ""

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopBoost()
        return START_NOT_STICKY
      }
      ACTION_START_AUTO -> startAuto(intent)
      else -> startManual(intent)
    }
    return START_STICKY
  }

  private fun startManual(intent: Intent?) {
    createChannel()
    auto = false
    showOverlay = intent?.getBooleanExtra(EXTRA_OVERLAY, false) ?: false
    val profile = parseObject(intent?.getStringExtra(EXTRA_PROFILE))
    appliedProfileName = profile.optString("name", "Boost")
    startForegroundCompat(buildNotification("Boost active", "Profile: $appliedProfileName"))
    isRunning = true
    try { BoostActions.applyProfile(this, profile) } catch (e: Exception) { }
    startOverlayIfNeeded()
    if (showOverlay) startWorker()
  }

  private fun startAuto(intent: Intent?) {
    createChannel()
    auto = true
    showOverlay = intent?.getBooleanExtra(EXTRA_OVERLAY, false) ?: false
    profiles = parseArray(intent?.getStringExtra(EXTRA_PROFILES))
    appliedPackage = null
    appliedProfileName = ""
    startForegroundCompat(buildNotification("Auto boost", "Watching for games…"))
    isRunning = true
    startOverlayIfNeeded()
    startWorker()
  }

  private fun startWorker() {
    if (workThread == null) {
      workThread = HandlerThread("cantoshub-watch").also { it.start() }
      workHandler = Handler(workThread!!.looper)
    }
    workHandler?.post(tick)
  }

  private val tick = object : Runnable {
    override fun run() {
      if (!isRunning) return
      try {
        if (auto) handleAuto()
        if (showOverlay) overlay?.update(buildHudText())
      } catch (e: Exception) {
      }
      workHandler?.postDelayed(this, POLL_MS)
    }
  }

  private fun handleAuto() {
    val fg = currentForegroundApp()
    val match = if (fg.isNullOrEmpty()) {
      null
    } else {
      profiles.firstOrNull { it.optString("packageName", "") == fg }
    }
    val matchPkg = match?.optString("packageName")
    if (matchPkg == appliedPackage) return

    // Switching profile: revert whatever is applied, then apply the new match.
    if (appliedPackage != null) {
      try { BoostActions.revert(this) } catch (e: Exception) { }
      try { ShizukuActions.revert(this) { } } catch (e: Exception) { }
    }
    if (match != null) {
      try { BoostActions.applyProfile(this, match) } catch (e: Exception) { }
      if (ShizukuManager.hasPermission()) {
        try { ShizukuActions.apply(this, match) { } } catch (e: Exception) { }
      }
      appliedPackage = matchPkg
      appliedProfileName = match.optString("name", "Boost")
      updateNotification("Auto boost", "Active: $appliedProfileName")
    } else {
      appliedPackage = null
      appliedProfileName = ""
      updateNotification("Auto boost", "Watching for games…")
    }
  }

  private fun stopBoost() {
    workHandler?.removeCallbacksAndMessages(null)
    workThread?.quitSafely()
    workThread = null
    workHandler = null
    try { BoostActions.revert(this) } catch (e: Exception) { }
    try { ShizukuActions.revert(this) { } } catch (e: Exception) { }
    overlay?.hide()
    overlay = null
    appliedPackage = null
    isRunning = false
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    if (isRunning) {
      try { BoostActions.revert(this) } catch (e: Exception) { }
      try { ShizukuActions.revert(this) { } } catch (e: Exception) { }
      overlay?.hide()
      isRunning = false
    }
    super.onDestroy()
  }

  private fun startOverlayIfNeeded() {
    if (showOverlay) {
      overlay = OverlayHud(this)
      overlay?.show()
    }
  }

  private fun currentForegroundApp(): String? {
    return try {
      val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val now = System.currentTimeMillis()
      val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 60_000, now)
      stats?.maxByOrNull { it.lastTimeUsed }?.packageName
    } catch (e: Exception) {
      null
    }
  }

  private fun buildHudText(): String {
    val bm = getSystemService(Context.BATTERY_SERVICE) as BatteryManager
    val batt = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)
    val am = getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
    val mi = ActivityManager.MemoryInfo()
    am.getMemoryInfo(mi)
    val usedG = (mi.totalMem - mi.availMem) / 1e9
    val totG = mi.totalMem / 1e9
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    val therm = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      thermalShort(pm.currentThermalStatus)
    } else {
      "?"
    }
    val tag = when {
      !auto -> appliedProfileName
      appliedProfileName.isNotEmpty() -> appliedProfileName
      else -> "watching"
    }
    return String.format(
      Locale.US,
      "⚡ %s  •  %s  •  %d%%  •  %.1f/%.1fG",
      tag, therm, batt, usedG, totG,
    )
  }

  private fun thermalShort(status: Int): String = when (status) {
    0, 1 -> "cool"
    2, 3 -> "warm"
    4, 5, 6 -> "HOT"
    else -> "?"
  }

  private fun parseObject(s: String?): JSONObject = try {
    JSONObject(s ?: "{}")
  } catch (e: Exception) {
    JSONObject()
  }

  private fun parseArray(s: String?): List<JSONObject> = try {
    val arr = JSONArray(s ?: "[]")
    (0 until arr.length()).map { arr.getJSONObject(it) }
  } catch (e: Exception) {
    emptyList()
  }

  private fun startForegroundCompat(notification: Notification) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIF_ID, notification)
    }
  }

  private fun updateNotification(title: String, text: String) {
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.notify(NOTIF_ID, buildNotification(title, text))
  }

  private fun buildNotification(title: String, text: String): Notification {
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    return builder
      .setContentTitle("CantosHub · $title")
      .setContentText(text)
      .setSmallIcon(android.R.drawable.ic_media_play)
      .setOngoing(true)
      .build()
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL_ID) == null) {
        val channel = NotificationChannel(
          CHANNEL_ID,
          "Game Boost",
          NotificationManager.IMPORTANCE_LOW,
        )
        channel.description = "Shows while a boost profile is active"
        nm.createNotificationChannel(channel)
      }
    }
  }
}
