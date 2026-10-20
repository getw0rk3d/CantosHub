package com.cantoshub

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Kids Mode lock (no root). While active, only the parent's allowed apps (plus
 * CantosHub's kids screen) may be in the foreground. Anything else is covered by a
 * full-screen "ask a grown-up" overlay and the kids screen is brought back.
 *
 * With Shizuku it also locks the system bar (no notification shade / Recents) and
 * makes CantosHub the Home app, then restores both when Kids Mode ends.
 */
class KidsService : Service() {
  companion object {
    const val ACTION_START = "com.cantoshub.kids.START"
    const val ACTION_STOP = "com.cantoshub.kids.STOP"
    private const val CHANNEL_ID = "cantoshub_kids"
    private const val NOTIF_ID = 7342
    private const val POLL_MS = 500L
    const val HOME_ALIAS = "com.cantoshub.KidsHome"

    // Never block these: system UI, Android's own dialogs, runtime-permission prompts
    // and Google sign-in / purchase-free popups that allowed apps show.
    private val ALWAYS_OK = setOf(
      "android",
      "com.android.systemui",
      "com.android.permissioncontroller",
      "com.google.android.permissioncontroller",
      "com.google.android.gms",
    )

    @Volatile
    var isRunning = false
      private set

    fun start(ctx: Context) {
      val i = Intent(ctx, KidsService::class.java).setAction(ACTION_START)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
    }

    fun stop(ctx: Context) {
      ctx.startService(Intent(ctx, KidsService::class.java).setAction(ACTION_STOP))
    }

    /** Undo the Shizuku-level changes (system bar + Home). Safe to call repeatedly. */
    fun releaseSystemLock(ctx: Context) {
      if (!ShizukuManager.hasPermission()) return
      ShizukuManager.exec(ctx, listOf("cmd", "statusbar", "send-disable-flag", "none")) { }
      val prev = KidsPrefs.prevHome(ctx)
      if (prev.isNotEmpty()) {
        ShizukuManager.exec(ctx, listOf("cmd", "package", "set-home-activity", prev)) { }
      }
      setHomeAliasEnabled(ctx, false)
      KidsPrefs.setPrevHome(ctx, "")
    }

    private fun setHomeAliasEnabled(ctx: Context, enabled: Boolean) {
      try {
        ctx.packageManager.setComponentEnabledSetting(
          ComponentName(ctx.packageName, HOME_ALIAS),
          if (enabled) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
          PackageManager.DONT_KILL_APP,
        )
      } catch (e: Exception) {
      }
    }
  }

  private var thread: HandlerThread? = null
  private var handler: Handler? = null
  private val main = Handler(Looper.getMainLooper())
  private var cover: LinearLayout? = null
  private var lastFg: String? = null
  private var lastQuery = 0L
  private var lastBounce = 0L

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      shutdown()
      return START_NOT_STICKY
    }
    // ACTION_START, or a system restart (null intent) while Kids Mode is still on.
    createChannel()
    startForegroundCompat()
    if (!KidsPrefs.isActive(this)) {
      shutdown()
      return START_NOT_STICKY
    }
    isRunning = true
    applySystemLock()
    if (thread == null) {
      thread = HandlerThread("cantoshub-kids").also { it.start() }
      handler = Handler(thread!!.looper)
    }
    handler?.removeCallbacks(tick)
    handler?.post(tick)
    return START_STICKY
  }

  private fun applySystemLock() {
    if (!ShizukuManager.hasPermission()) return
    // Remember the current Home once, then make CantosHub's kids screen the Home app.
    if (KidsPrefs.prevHome(this).isEmpty()) {
      ShizukuManager.exec(
        this,
        listOf("cmd", "package", "resolve-activity", "--brief", "-a", "android.intent.action.MAIN", "-c", "android.intent.category.HOME"),
      ) { out ->
        val home = out?.lines()?.map { it.trim() }?.lastOrNull { it.contains("/") } ?: ""
        if (home.isNotEmpty() && !home.startsWith(packageName)) KidsPrefs.setPrevHome(this, home)
        setHomeAliasEnabled(this, true)
        ShizukuManager.exec(this, listOf("cmd", "package", "set-home-activity", "$packageName/$HOME_ALIAS")) { }
      }
    }
    ShizukuManager.exec(this, listOf("cmd", "statusbar", "send-disable-flag", "statusbar-expansion", "recents")) { }
  }

  private val tick = object : Runnable {
    override fun run() {
      if (!isRunning) return
      try {
        check()
      } catch (e: Exception) {
      }
      handler?.postDelayed(this, POLL_MS)
    }
  }

  private fun check() {
    val fg = foreground() ?: return
    if (isOk(fg)) {
      hideCover()
      return
    }
    showCover()
    val now = System.currentTimeMillis()
    if (now - lastBounce > 1500) {
      lastBounce = now
      bringKidsScreen()
    }
  }

  private fun isOk(pkg: String): Boolean {
    if (pkg == packageName || pkg in ALWAYS_OK) return true
    if (pkg in KidsPrefs.allowed(this)) return true
    // Calls must always get through (also emergency calls).
    if (isCallActive() || Cleanup.isCallApp(pkg)) return true
    // The phone's own lock screen / PIN check used as the "forgot Kids PIN" fallback.
    if (KidsPrefs.systemAllowed(this) && (pkg.contains("settings") || pkg.contains("biometric"))) return true
    return false
  }

  private fun bringKidsScreen() {
    try {
      startActivity(
        Intent(this, MainActivity::class.java).addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP,
        ),
      )
    } catch (e: Exception) {
    }
  }

  /** Last MOVE_TO_FOREGROUND package, tracked incrementally across polls. */
  private fun foreground(): String? {
    return try {
      val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val now = System.currentTimeMillis()
      val events = usm.queryEvents(if (lastQuery == 0L) now - 60_000 else lastQuery - 1000, now)
      val ev = UsageEvents.Event()
      while (events.hasNextEvent()) {
        events.getNextEvent(ev)
        if (ev.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND) lastFg = ev.packageName
      }
      lastQuery = now
      lastFg
    } catch (e: Exception) {
      lastFg
    }
  }

  private fun isCallActive(): Boolean = try {
    when ((getSystemService(Context.AUDIO_SERVICE) as AudioManager).mode) {
      AudioManager.MODE_IN_CALL, AudioManager.MODE_IN_COMMUNICATION, AudioManager.MODE_RINGTONE -> true
      else -> false
    }
  } catch (e: Exception) {
    false
  }

  // --- full-screen cover shown over a blocked app ---
  private fun showCover() {
    main.post {
      if (cover != null || !Settings.canDrawOverlays(this)) return@post
      val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
      val layout = LinearLayout(this).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setBackgroundColor(Color.parseColor("#1B1446"))
        setPadding(60, 60, 60, 60)
      }
      layout.addView(TextView(this).apply {
        text = "🔒"
        textSize = 56f
        gravity = Gravity.CENTER
      })
      layout.addView(TextView(this).apply {
        text = "Ask a grown-up"
        textSize = 28f
        setTextColor(Color.WHITE)
        gravity = Gravity.CENTER
        setPadding(0, 24, 0, 8)
      })
      layout.addView(TextView(this).apply {
        text = "This app isn't in your Kids apps."
        textSize = 16f
        setTextColor(Color.parseColor("#C9C3FF"))
        gravity = Gravity.CENTER
        setPadding(0, 0, 0, 48)
      })
      layout.addView(Button(this).apply {
        text = "Back to my apps"
        textSize = 18f
        isAllCaps = false
        setTextColor(Color.parseColor("#1B1446"))
        background = GradientDrawable().apply {
          cornerRadius = 80f
          setColor(Color.parseColor("#FFD43B"))
        }
        setPadding(70, 30, 70, 30)
        setOnClickListener { bringKidsScreen() }
      })
      val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
      } else {
        @Suppress("DEPRECATION")
        WindowManager.LayoutParams.TYPE_PHONE
      }
      val lp = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.MATCH_PARENT,
        type,
        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE,
        PixelFormat.OPAQUE,
      )
      try {
        wm.addView(layout, lp)
        cover = layout
      } catch (e: Exception) {
        cover = null
      }
    }
  }

  private fun hideCover() {
    main.post {
      cover?.let {
        try {
          (getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeView(it)
        } catch (e: Exception) {
        }
      }
      cover = null
    }
  }

  private fun shutdown() {
    isRunning = false
    handler?.removeCallbacksAndMessages(null)
    thread?.quitSafely()
    thread = null
    handler = null
    hideCover()
    releaseSystemLock(this)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    isRunning = false
    handler?.removeCallbacksAndMessages(null)
    thread?.quitSafely()
    hideCover()
    super.onDestroy()
  }

  private fun startForegroundCompat() {
    val open = PendingIntent.getActivity(
      this, 3,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val b = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL_ID) else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }
    val n = b.setContentTitle("CantosHub · Kids Mode on")
      .setContentText("Only your chosen apps can be opened")
      .setSmallIcon(R.drawable.ic_tile_boost)
      .setOngoing(true)
      .setContentIntent(open)
      .build()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
    } else {
      startForeground(NOTIF_ID, n)
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL_ID) == null) {
        nm.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Kids Mode", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Shows while Kids Mode is locking the phone to your chosen apps"
          },
        )
      }
    }
  }
}
