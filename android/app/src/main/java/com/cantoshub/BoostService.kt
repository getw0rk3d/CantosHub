package com.cantoshub

import android.app.ActivityManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioManager
import android.net.wifi.WifiManager
import android.os.BatteryManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.Locale
import java.util.concurrent.Executors
import kotlin.math.roundToInt

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
    const val ACTION_UPDATE_PROFILES = "com.cantoshub.action.UPDATE_PROFILES"
    const val EXTRA_PROFILE = "profile"
    const val EXTRA_PROFILES = "profiles"
    const val EXTRA_OVERLAY = "overlay"
    const val EXTRA_FREERAM = "freeram"
    private const val CHANNEL_ID = "cantoshub_boost"
    private const val NOTIF_ID = 7341
    private const val POLL_MS = 4000L
    private const val RESTART_PREFS = "cantoshub_service"
    private const val KEY_LAST_ACTION = "last_action"
    private const val KEY_LAST_EXTRAS = "last_extras"

    // Require this many consecutive ticks on a real, different app before we
    // conclude the user left the game and revert — absorbs transient blips
    // (ads, sign-in popups, a quick home tap) that would otherwise cause churn.
    private const val REVERT_MISSES = 2

    // Foreground packages that mean "can't identify the game / user peeked",
    // NOT "left the game" — never revert on these.
    private val IGNORED_FG = listOf(
      "com.android.systemui",
      "com.google.android.gms",
    )

    // Auto restarted by the system with settings still applied from before: which game they
    // were for is gone, so the next game (or leaving it) switches/reverts as usual.
    private const val UNKNOWN_GAME = "?"

    @Volatile
    var isRunning = false
      private set

    /** What's running, for the app: Auto or Manual, and the profile / game in use. */
    @Volatile
    var isAuto = false
      private set

    @Volatile
    var runningProfileId: String? = null
      private set

    @Volatile
    var boostedGame: String? = null
      private set

    /**
     * Every settings change of a boost (apply, revert, Free RAM) runs here, one at a time and
     * in order. They used to run on whichever thread asked, so a Stop right after a Start could
     * revert before the start's changes landed, leaving them on with no boost running.
     */
    private val applier = Executors.newSingleThreadExecutor { r -> Thread(r, "cantoshub-boost").apply { isDaemon = true } }

    /**
     * Start a boost from outside the app (home-screen shortcut, Quick tile) the way the app
     * would: Auto when the app is in Auto mode (never replaced by a one-profile boost),
     * otherwise [profile]. Settings are the app's last saved ones (QuickPrefs).
     */
    fun startFromOutside(ctx: Context, profile: JSONObject?) {
      val auto = QuickPrefs.autoMode(ctx) && QuickPrefs.profilesJson(ctx) != "[]"
      if (auto && isRunning && isAuto) return
      if (!auto && profile == null) return
      val intent = Intent(ctx, BoostService::class.java).apply {
        if (auto) {
          action = ACTION_START_AUTO
          putExtra(EXTRA_PROFILES, QuickPrefs.profilesJson(ctx))
        } else {
          action = ACTION_START
          putExtra(EXTRA_PROFILE, profile.toString())
        }
        putExtra(EXTRA_OVERLAY, QuickPrefs.showOverlay(ctx))
        putExtra(EXTRA_FREERAM, QuickPrefs.freeRam(ctx))
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(intent) else ctx.startService(intent)
    }

    /** No boost running but PRO changes still recorded (Shizuku was gone): undo them now. */
    fun undoLeftovers(ctx: Context) {
      if (isRunning || !ShizukuManager.canRun()) return
      val (frozen, res) = ShizukuActions.pending(ctx)
      if (frozen > 0 || res) applier.execute { ShizukuActions.revert(ctx) { } }
    }
  }

  private var workThread: HandlerThread? = null
  private var workHandler: Handler? = null
  private var overlay: OverlayHud? = null

  private var showOverlay = false
  private var freeRamOnBoost = true
  private var auto = false
  private var wifiLock: WifiManager.WifiLock? = null
  private var profiles: List<JSONObject> = emptyList()
  private var appliedPackage: String? = null
  private var appliedProfileName: String = ""
  private var appliedProfile: JSONObject? = null // what's applied now (both modes)

  // Auto-mode foreground tracking + anti-flap state.
  private var missCount = 0
  private var lastFreedPkg: String? = null // Free RAM runs once per game session
  private var lastKnownFg: String? = null // last real MOVE_TO_FOREGROUND package
  private var lastEventQueryTime = 0L
  private var tickCount = 0

  // FPS sampling (Shizuku only): average rendered FPS from gfxinfo frame deltas.
  private var lastFrames = -1
  private var lastFramesAt = 0L
  private var lastFpsPkg: String? = null
  private var currentFps = -1

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent == null) {
      val restored = restoreLastStart()
      if (restored == null) {
        // Nothing to resume: satisfy the foreground-service contract, then stop.
        createChannel()
        startForegroundCompat(buildNotification("Stopping", ""))
        stopBoost()
        return START_NOT_STICKY
      }
      if (restored.action == ACTION_START_AUTO) startAuto(restored, restarted = true) else startManual(restored)
      return START_STICKY
    }
    when (intent.action) {
      ACTION_STOP -> {
        stopBoost()
        return START_NOT_STICKY
      }
      ACTION_UPDATE_PROFILES -> {
        // Live profile edits while boosting: no re-boost, no second Free RAM.
        if (isRunning) {
          val json = intent.getStringExtra(EXTRA_PROFILES)
          val list = parseArray(json)
          // Auto's state lives on the watch thread.
          if (auto) workHandler?.post { onProfilesEdited(list, json) } ?: onProfilesEdited(list, json)
          else onProfilesEdited(list, json)
        }
        return START_STICKY
      }
      ACTION_START_AUTO -> {
        rememberStart(ACTION_START_AUTO, intent.getStringExtra(EXTRA_PROFILES), intent)
        startAuto(intent)
      }
      else -> {
        rememberStart(ACTION_START, intent.getStringExtra(EXTRA_PROFILE), intent)
        startManual(intent)
      }
    }
    return START_STICKY
  }

  /** Persist the last start so a system restart (null intent) resumes the same boost. */
  private fun rememberStart(action: String, payload: String?, intent: Intent?) {
    val sp = getSharedPreferences(RESTART_PREFS, Context.MODE_PRIVATE)
    val prev = try { JSONObject(sp.getString(KEY_LAST_EXTRAS, "{}") ?: "{}") } catch (e: Exception) { JSONObject() }
    val extras = JSONObject()
      .put("payload", payload ?: prev.optString("payload", ""))
      .put("overlay", intent?.getBooleanExtra(EXTRA_OVERLAY, false) ?: prev.optBoolean("overlay", false))
    sp.edit().putString(KEY_LAST_ACTION, action).putString(KEY_LAST_EXTRAS, extras.toString()).apply()
  }

  private fun restoreLastStart(): Intent? {
    val sp = getSharedPreferences(RESTART_PREFS, Context.MODE_PRIVATE)
    val action = sp.getString(KEY_LAST_ACTION, null) ?: return null
    val extras = try { JSONObject(sp.getString(KEY_LAST_EXTRAS, "{}") ?: "{}") } catch (e: Exception) { return null }
    val payload = extras.optString("payload", "")
    if (payload.isEmpty()) return null
    return Intent(this, BoostService::class.java).apply {
      this.action = action
      putExtra(if (action == ACTION_START_AUTO) EXTRA_PROFILES else EXTRA_PROFILE, payload)
      putExtra(EXTRA_OVERLAY, extras.optBoolean("overlay", false))
      putExtra(EXTRA_FREERAM, false) // never kill apps just because the service was restarted
    }
  }

  private fun forgetStart() {
    getSharedPreferences(RESTART_PREFS, Context.MODE_PRIVATE).edit().clear().apply()
  }

  private fun startManual(intent: Intent?) {
    createChannel()
    val wasRunning = isRunning
    val prevGame = (if (auto) appliedPackage else appliedProfile?.optString("packageName", "")) ?: ""
    auto = false
    showOverlay = intent?.getBooleanExtra(EXTRA_OVERLAY, false) ?: false
    freeRamOnBoost = intent?.getBooleanExtra(EXTRA_FREERAM, true) ?: true
    val profile = parseObject(intent?.getStringExtra(EXTRA_PROFILE))
    appliedProfileName = profile.optString("name", "Boost")
    appliedProfile = profile
    appliedPackage = null
    val pkg = profile.optString("packageName", "")
    publishState(profile.optString("id", "").ifEmpty { null }, pkg.ifEmpty { null })
    startForegroundCompat(buildNotification("Boost active", "Profile: $appliedProfileName"))
    isRunning = true
    acquireWifiLock()
    // Same game again (Play tapped twice): no second kill sweep.
    val freeRam = freeRamOnBoost && !(wasRunning && pkg.isNotBlank() && pkg == prevGame)
    // Off the main thread (Settings writes + a kill sweep would jank/ANR right as the user
    // taps Start), in order with every other boost change.
    applier.execute {
      // A boost was already on: undo it first, so its PRO changes (lowered resolution, frozen
      // apps) don't stay on under the new profile.
      if (wasRunning) revertNow()
      try { BoostActions.applyProfile(this, profile) } catch (e: Exception) { }
      if (ShizukuManager.hasPermission()) {
        try { ShizukuActions.apply(this, profile) { } } catch (e: Exception) { }
      }
      if (pkg.isNotBlank()) StatsStore.recordSession(this, pkg)
      if (freeRam) {
        try { Cleanup.killBackground(this, if (pkg.isNotBlank()) pkg else null) } catch (e: Exception) { }
      }
    }
    startOverlayIfNeeded()
    if (showOverlay) startWorker() else workHandler?.removeCallbacks(tick) // was Auto: stop watching
  }

  private fun startAuto(intent: Intent?, restarted: Boolean = false) {
    createChannel()
    val wasRunning = isRunning
    auto = true
    showOverlay = intent?.getBooleanExtra(EXTRA_OVERLAY, false) ?: false
    freeRamOnBoost = intent?.getBooleanExtra(EXTRA_FREERAM, true) ?: true
    profiles = parseArray(intent?.getStringExtra(EXTRA_PROFILES))
    // The previous boost (a manual profile, or the old Auto's game) comes off before watching.
    if (wasRunning) applier.execute { revertNow() }
    // Restarted by the system with a game's settings still on: keep them owed, so leaving the
    // game (or switching) reverts them - they used to stay on until Stop.
    val owed = restarted && (BoostActions.hasSnapshot(this) || ShizukuActions.pending(this).let { it.first > 0 || it.second })
    appliedPackage = if (owed) UNKNOWN_GAME else null
    appliedProfileName = ""
    appliedProfile = null
    missCount = 0
    lastFreedPkg = null
    lastKnownFg = null
    lastEventQueryTime = 0L
    publishState(null, null)
    startForegroundCompat(buildNotification("Auto boost", "Watching for games…"))
    isRunning = true
    acquireWifiLock()
    startOverlayIfNeeded()
    startWorker()
  }

  /** Undo everything a boost changed. Runs on [applier]. */
  private fun revertNow() {
    try { BoostActions.revert(this) } catch (e: Exception) { }
    try { ShizukuActions.revert(this) { } } catch (e: Exception) { }
  }

  private fun publishState(profileId: String?, game: String?) {
    isAuto = auto
    runningProfileId = profileId
    boostedGame = game
  }

  /**
   * The app saved edited profiles while boosting. Re-apply the profile in use if it changed (a
   * quick toggle, a new resolution, another freeze list) - Auto only swapped its list before,
   * so edits to the game being played never took effect, and Manual ignored edits entirely.
   * In Auto a profile deleted or unbound from the current game ends that game's boost; in
   * Manual a deleted profile keeps running as started.
   */
  private fun onProfilesEdited(list: List<JSONObject>, json: String?) {
    if (!isRunning) return
    if (auto) {
      profiles = list
      rememberStart(ACTION_START_AUTO, json, null)
      val game = appliedPackage ?: return
      if (game == UNKNOWN_GAME) return
      val now = list.firstOrNull { it.optString("packageName", "") == game }
      if (now == null) {
        applier.execute { revertNow() }
        appliedPackage = null
        appliedProfileName = ""
        appliedProfile = null
        lastFreedPkg = null
        publishState(null, null)
        updateNotification("Auto boost", "Watching for games…")
        return
      }
      reapply(now)
      updateNotification("Auto boost", "Active: $appliedProfileName")
    } else {
      val running = appliedProfile ?: return
      val id = running.optString("id", "")
      if (id.isEmpty()) return
      val now = list.firstOrNull { it.optString("id", "") == id } ?: return
      // Keep the game it was started for (a shortcut can start a profile for another game).
      val next = JSONObject(now.toString()).put("packageName", running.optString("packageName", ""))
      rememberStart(ACTION_START, next.toString(), null)
      reapply(next)
      updateNotification("Boost active", "Profile: $appliedProfileName")
    }
  }

  private fun reapply(next: JSONObject) {
    val prev = appliedProfile ?: JSONObject()
    if (prev.toString() == next.toString()) return
    appliedProfile = next
    appliedProfileName = next.optString("name", "Boost")
    val proChanged = prev.optDouble("resolutionScale", 1.0) != next.optDouble("resolutionScale", 1.0) ||
      (prev.optJSONArray("freezeApps")?.toString() ?: "[]") != (next.optJSONArray("freezeApps")?.toString() ?: "[]")
    applier.execute {
      // The no-root toggles switch over in place (each one undoes only what a boost set).
      try { BoostActions.applyProfile(this, next) } catch (e: Exception) { }
      if (proChanged) {
        try { ShizukuActions.revert(this) { } } catch (e: Exception) { }
        if (ShizukuManager.hasPermission()) {
          try { ShizukuActions.apply(this, next) { } } catch (e: Exception) { }
        }
      }
    }
  }

  private fun startWorker() {
    if (workThread == null) {
      workThread = HandlerThread("cantoshub-watch").also { it.start() }
      workHandler = Handler(workThread!!.looper)
    }
    workHandler?.removeCallbacks(tick)
    workHandler?.post(tick)
  }

  private val tick = object : Runnable {
    override fun run() {
      if (!isRunning) return
      try {
        if (auto) handleAuto()
        if (showOverlay) {
          tickCount++
          // Throttle the gfxinfo FPS sample — it perturbs the game being measured.
          if (ShizukuManager.hasPermission() && tickCount % 2 == 0) sampleFps()
          overlay?.update(buildHudText())
        }
      } catch (e: Exception) {
      }
      workHandler?.postDelayed(this, POLL_MS)
    }
  }

  private fun handleAuto() {
    val fg = currentForegroundApp()
    // Hold the current boost steady during a phone call (see isCallActive/isCallApp).
    if (isCallActive() || Cleanup.isCallApp(fg)) return
    // "Can't identify the game / user peeked at an overlay" is NOT "left the game" —
    // never revert on our own package or transient system UI (shade, sign-in popups).
    if (fg.isNullOrEmpty() || fg == packageName || IGNORED_FG.any { fg.startsWith(it) }) return

    val match = profiles.firstOrNull { it.optString("packageName", "") == fg }
    val matchPkg = match?.optString("packageName")

    if (matchPkg == appliedPackage) {
      missCount = 0
      return
    }

    if (match != null) {
      // A (different) profiled game is now foreground — switch to it. The revert is queued
      // ahead of the apply, so it finishes first (see ShizukuManager.submit).
      val switching = appliedPackage != null
      // Free RAM at most once per game session — never a mid-game kill-storm.
      val freeRam = freeRamOnBoost && matchPkg != null && matchPkg != lastFreedPkg
      applier.execute {
        if (switching) revertNow()
        try { BoostActions.applyProfile(this, match) } catch (e: Exception) { }
        if (ShizukuManager.hasPermission()) {
          try { ShizukuActions.apply(this, match) { } } catch (e: Exception) { }
        }
        if (freeRam) {
          try { Cleanup.killBackground(this, matchPkg) } catch (e: Exception) { }
        }
      }
      if (freeRam) lastFreedPkg = matchPkg
      appliedPackage = matchPkg
      appliedProfileName = match.optString("name", "Boost")
      appliedProfile = match
      publishState(null, matchPkg)
      if (matchPkg != null) StatsStore.recordSession(this, matchPkg)
      missCount = 0
      updateNotification("Auto boost", "Active: $appliedProfileName")
    } else if (appliedPackage != null) {
      // A real, non-game app is foreground. Debounce before reverting so a brief
      // blip (ad, sign-in, a quick home tap) can't tear down the boost mid-game.
      missCount++
      if (missCount >= REVERT_MISSES) {
        applier.execute { revertNow() }
        appliedPackage = null
        appliedProfileName = ""
        appliedProfile = null
        lastFreedPkg = null
        missCount = 0
        publishState(null, null)
        updateNotification("Auto boost", "Watching for games…")
      }
    }
  }

  private fun stopBoost() {
    forgetStart()
    workHandler?.removeCallbacksAndMessages(null)
    workThread?.quitSafely()
    workThread = null
    workHandler = null
    applier.execute { revertNow() } // after any apply still in flight
    releaseWifiLock()
    overlay?.hide()
    overlay = null
    appliedPackage = null
    appliedProfile = null
    isRunning = false
    auto = false
    publishState(null, null)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    if (isRunning) {
      applier.execute { revertNow() }
      releaseWifiLock()
      overlay?.hide()
      isRunning = false
      auto = false
      publishState(null, null)
    }
    super.onDestroy()
  }

  /** High-performance / low-latency Wi-Fi lock — cuts Wi-Fi power-save jitter for online games. */
  private fun acquireWifiLock() {
    releaseWifiLock() // avoid leaking a prior lock on a re-entrant boost start
    try {
      val wm = applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        WifiManager.WIFI_MODE_FULL_LOW_LATENCY
      } else {
        @Suppress("DEPRECATION")
        WifiManager.WIFI_MODE_FULL_HIGH_PERF
      }
      val lock = wm.createWifiLock(mode, "cantoshub:boost")
      lock.setReferenceCounted(false)
      lock.acquire()
      wifiLock = lock
    } catch (e: Exception) {
    }
  }

  private fun releaseWifiLock() {
    try {
      wifiLock?.let { if (it.isHeld) it.release() }
    } catch (e: Exception) {
    }
    wifiLock = null
  }

  private fun startOverlayIfNeeded() {
    // Tear down any existing overlay first so a re-entrant start can't orphan a view.
    overlay?.hide()
    overlay = null
    if (showOverlay) {
      overlay = OverlayHud(this).also { it.show() }
    }
  }

  /** True while the phone is ringing or in a call (telephony or VoIP). No permission needed. */
  private fun isCallActive(): Boolean {
    return try {
      val am = getSystemService(Context.AUDIO_SERVICE) as AudioManager
      when (am.mode) {
        AudioManager.MODE_IN_CALL,
        AudioManager.MODE_IN_COMMUNICATION,
        AudioManager.MODE_RINGTONE,
        -> true
        else -> false
      }
    } catch (e: Exception) {
      false
    }
  }

  /**
   * Reliable foreground app via UsageEvents (the last MOVE_TO_FOREGROUND). The old
   * `maxByOrNull { lastTimeUsed }` heuristic was broken — a game's lastTimeUsed is
   * frozen while it stays foreground, so any other app's later event "won" the vote
   * and made CantosHub think the user left the game. We track the last real
   * foreground transition across polls so a steadily-running game stays detected.
   */
  private fun currentForegroundApp(): String? {
    return try {
      val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val now = System.currentTimeMillis()
      val begin = if (lastEventQueryTime == 0L) now - 60_000 else lastEventQueryTime
      val events = usm.queryEvents(begin, now)
      val ev = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(ev)
        if (ev.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) {
          lastKnownFg = ev.packageName
        }
      }
      lastEventQueryTime = now
      lastKnownFg
    } catch (e: Exception) {
      lastKnownFg
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
    val base = String.format(
      Locale.US,
      "⚡ %s  •  %s  •  %d%%  •  %.1f/%.1fG",
      tag, therm, batt, usedG, totG,
    )
    return if (currentFps >= 0) "$base  •  $currentFps fps" else base
  }

  /** Average rendered FPS via Shizuku `dumpsys gfxinfo` total-frame deltas. */
  private var fpsSince = 0L            // when the sample in flight started (0 = none)

  private fun sampleFps() {
    // A slow gfxinfo must not pile up a queue of samples; give up on one after 10 s.
    if (fpsSince > 0L && System.currentTimeMillis() - fpsSince < 10_000) return
    val pkg = currentForegroundApp() ?: return
    fpsSince = System.currentTimeMillis()
    ShizukuManager.exec(this, listOf("dumpsys", "gfxinfo", pkg)) { out ->
      fpsSince = 0L
      val frames = parseTotalFrames(out)
      val now = System.currentTimeMillis()
      if (frames >= 0) {
        if (pkg == lastFpsPkg && frames == lastFrames) {
          // No app-drawn frames: a game engine (Unity, Unreal...) draws on its own surface,
          // which gfxinfo doesn't count. Hide FPS rather than show "0 fps".
          currentFps = -1
        } else if (pkg == lastFpsPkg && lastFrames in 0..frames && lastFramesAt > 0L) {
          val dt = (now - lastFramesAt) / 1000.0
          if (dt > 0.3) {
            currentFps = ((frames - lastFrames) / dt).roundToInt()
            StatsStore.recordFps(this, pkg, currentFps)
          }
        } else {
          currentFps = -1
        }
        lastFrames = frames
        lastFramesAt = now
        lastFpsPkg = pkg
      }
      if (showOverlay) overlay?.update(buildHudText())
    }
  }

  private fun parseTotalFrames(out: String?): Int {
    if (out == null) return -1
    val m = Regex("Total frames rendered:\\s*(\\d+)").find(out) ?: return -1
    return m.groupValues[1].toIntOrNull() ?: -1
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
    val piFlags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    val stopPi = PendingIntent.getService(
      this,
      1,
      Intent(this, BoostService::class.java).apply { action = ACTION_STOP },
      piFlags,
    )
    val openPi = PendingIntent.getActivity(
      this,
      2,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      piFlags,
    )
    return builder
      .setContentTitle("CantosHub · $title")
      .setContentText(text)
      .setSmallIcon(R.drawable.ic_tile_boost)
      .setOngoing(true)
      .setContentIntent(openPi)
      .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Stop boost", stopPi)
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
