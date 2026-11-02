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
    // The kids screen comes back right away; keep "Ask a grown-up" up long enough to read.
    private const val MIN_COVER_MS = 2500L
    const val HOME_ALIAS = "com.cantoshub.KidsHome"

    // Samsung Wallet's swipe-up-from-the-bottom card. It's an always-running service, so
    // blocking the Wallet screen afterwards still flashed the card; we stop the service.
    private const val WALLET = "com.samsung.android.spay"
    // Wallet's own database. Touching it starts Wallet's process, which brings the swipe-up
    // back, without anything showing on screen.
    private const val WALLET_PROVIDER = "com.samsung.android.spay.provider"

    // ActivityInfo.FLAG_SUPPORTS_PICTURE_IN_PICTURE (hidden in the SDK): video apps.
    private const val FLAG_SUPPORTS_PIP = 0x400000
    private val SAFE_PKG = Regex("^[A-Za-z0-9_.]+$") // package names go into shell scripts

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

    @Volatile
    var instance: KidsService? = null
      private set

    fun isCallActive(ctx: Context): Boolean = try {
      when ((ctx.getSystemService(Context.AUDIO_SERVICE) as AudioManager).mode) {
        AudioManager.MODE_IN_CALL, AudioManager.MODE_IN_COMMUNICATION, AudioManager.MODE_RINGTONE -> true
        else -> false
      }
    } catch (e: Exception) {
      false
    }

    fun start(ctx: Context) {
      val i = Intent(ctx, KidsService::class.java).setAction(ACTION_START)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) ctx.startForegroundService(i) else ctx.startService(i)
    }

    fun stop(ctx: Context) {
      ctx.startService(Intent(ctx, KidsService::class.java).setAction(ACTION_STOP))
    }

    /**
     * Undo Kids Mode's system changes. Safe to call repeatedly.
     * - The Home alias is our own component, so it's switched off WITHOUT needing Shizuku;
     *   Android then falls back to the normal launcher. (Requiring Shizuku here left
     *   CantosHub stuck as Home whenever Shizuku had died, e.g. after a reboot.)
     * - System-bar flags die with the Shizuku process anyway; reset them if it's alive.
     */
    fun releaseSystemLock(ctx: Context) {
      // Home borrowed through Android's prompt (no Shizuku): keep it until the parent has
      // picked their usual Home again. Switching the kids Home off first left Android with no
      // default, and its own "Select a Home app" sheet popped up over everything (where a tap
      // without "Always" saves nothing). The app opens Default home app instead and switches
      // the kids Home off once a new default exists (CantosHubModule.kidsGetConfig).
      if (!(KidsPrefs.tookHome(ctx) && homeRoleHeld(ctx))) setHomeAliasEnabled(ctx, false)
      if (ShizukuManager.canRun()) {
        releaseBar(ctx) // only when Kids lock really switched the bar off (not on every app start)
        val prev = KidsPrefs.prevHome(ctx)
        if (prev.isNotEmpty()) {
          ShizukuManager.exec(ctx, listOf("cmd", "package", "set-home-activity", prev)) { }
        }
      }
      KidsPrefs.setPrevHome(ctx, "")
      restartWalletIfStopped(ctx)
      restorePip(ctx)
    }

    /**
     * Unlocking: close the apps the kid used and clear them from Recents (PRO). Their tasks go
     * first - `am stack remove` drops the Recents card too, a force-stop alone leaves it - then
     * the app itself. Without a shell now it's skipped, not owed: later the parent may be
     * using those apps.
     */
    fun closeUsedApps(ctx: Context) {
      val used = KidsPrefs.used(ctx).filter { SAFE_PKG.matches(it) && it != ctx.packageName }
      KidsPrefs.setUsed(ctx, emptySet())
      if (used.isEmpty() || !ShizukuManager.canRun()) return
      ShizukuManager.exec(ctx, listOf("sh", "-c", used.joinToString("; ") { closeScript(it) } + "; true")) { }
      HiddenApps.rehide(ctx, used) // Kids apps hidden from the phone: closed now, so hide them again
    }

    /**
     * Shell that closes [pkg] like swiping it away in Recents: its tasks go first (that drops
     * the Recents card too), then the app - a force-stop alone left the card, and a task it
     * emptied can't be found to remove afterwards. [pkg] must match SAFE_PKG.
     */
    private fun closeScript(pkg: String) =
      "for r in \$(am stack list | awk -v p=$pkg '/^RootTask id=/{split(\$2,a,\"=\");r=a[2]} index(\$0,\": \" p \"/\"){print r}'); " +
        "do am stack remove \$r; done; am force-stop $pkg"

    /** Give back the picture-in-picture Kids Mode switched off (see blockPip). */
    fun restorePip(ctx: Context) {
      val saved = KidsPrefs.pipRestore(ctx).filterKeys { SAFE_PKG.matches(it) }
      if (saved.isEmpty() || KidsPrefs.isActive(ctx) || !ShizukuManager.canRun()) return
      // One app failing (uninstalled meanwhile) mustn't keep the rest owed forever.
      val script = saved.entries.joinToString("; ") { (p, m) -> "appops set $p PICTURE_IN_PICTURE $m 2>/dev/null" }
      ShizukuManager.exec(ctx, listOf("sh", "-c", "$script; true")) { out ->
        if (out != null && !out.startsWith("ERR") && !KidsPrefs.isActive(ctx)) KidsPrefs.setPipRestore(ctx, emptyMap())
      }
    }

    fun supportsPip(ctx: Context, pkg: String): Boolean = try {
      @Suppress("DEPRECATION")
      ctx.packageManager.getPackageInfo(pkg, PackageManager.GET_ACTIVITIES)
        .activities?.any { it.flags and FLAG_SUPPORTS_PIP != 0 } == true
    } catch (e: Exception) {
      false
    }

    /**
     * Turn the notification shade and Recents back on once Kids Mode is off. Without Shizuku
     * this can't be done, so the flag stays set and it's retried when Shizuku comes back
     * (MainApplication), when it's granted, and whenever the app reads the Kids settings.
     */
    fun releaseBar(ctx: Context) {
      if (!KidsPrefs.barLocked(ctx) || KidsPrefs.isActive(ctx) || !ShizukuManager.canRun()) return
      ShizukuManager.exec(ctx, listOf("cmd", "statusbar", "send-disable-flag", "none")) { out ->
        if (out != null && !out.startsWith("ERR") && !KidsPrefs.isActive(ctx)) KidsPrefs.setBarLocked(ctx, false)
      }
    }

    /**
     * Wallet's swipe-up comes back once its process runs again. Starting it through its content
     * provider shows nothing; opening Wallet itself (as before) slid its card up by itself right
     * after unlocking. The shell is the fallback if Android won't let CantosHub reach it.
     */
    private fun restartWalletIfStopped(ctx: Context) {
      if (!KidsPrefs.walletStopped(ctx)) return
      KidsPrefs.setWalletStopped(ctx, false)
      Thread {
        val ok = try {
          ctx.contentResolver.acquireUnstableContentProviderClient(WALLET_PROVIDER)?.also { it.close() } != null
        } catch (e: Exception) {
          false
        }
        if (!ok && ShizukuManager.canRun()) {
          ShizukuManager.exec(ctx, listOf("sh", "-c", "content query --uri content://$WALLET_PROVIDER/none >/dev/null 2>&1; true")) { }
        }
      }.start()
    }

    /**
     * The phone navigates with swipe gestures (AOSP navigation_mode 1/2; Samsung's is 3).
     * Kids Mode must then NOT make itself the Home app: Samsung only runs its swipe
     * gestures while One UI Home is the default Home ("gesture disabled or blocked" in the
     * log), so the Home swipe stopped working and a kid could not leave a game at all. With
     * gestures, swiping Home briefly shows One UI Home and the lock sends the kid straight
     * back to the kids screen instead.
     */
    fun usesGestureNav(ctx: Context): Boolean = try {
      Settings.Secure.getInt(ctx.contentResolver, "navigation_mode", 0) != 0
    } catch (e: Exception) {
      false
    }

    fun homeRoleHeld(ctx: Context): Boolean = try {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q &&
        (ctx.getSystemService(Context.ROLE_SERVICE) as android.app.role.RoleManager)
          .isRoleHeld(android.app.role.RoleManager.ROLE_HOME)
    } catch (e: Exception) {
      false
    }

    fun setHomeAliasEnabled(ctx: Context, enabled: Boolean) {
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
  private var coverShownAt = 0L
  private var lastFg: String? = null
  private var lastQuery = 0L
  private var lastBounce = 0L
  private var ticks = 0
  // The kids app in front at the last check, and the ones used so far (see closeUsedApps).
  @Volatile private var inApp: String? = null
  private val usedNow = mutableSetOf<String>()
  private val pipApps = java.util.concurrent.ConcurrentHashMap<String, Boolean>()

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
    instance = this
    usedNow.addAll(KidsPrefs.used(this)) // Android restarted the service mid-session
    applySystemLock()
    if (thread == null) {
      thread = HandlerThread("cantoshub-kids").also { it.start() }
      handler = Handler(thread!!.looper)
    }
    handler?.removeCallbacks(tick)
    handler?.post(tick)
    return START_STICKY
  }

  /** A shell became available while Kids Mode is on and the top bar isn't locked yet. */
  fun reapplyLock() {
    if (isRunning && KidsPrefs.isActive(this) && !KidsPrefs.barLocked(this)) handler?.post { applySystemLock() }
  }

  private fun applySystemLock() {
    if (!ShizukuManager.hasPermission()) return
    // Remember the current Home once, then make CantosHub's kids screen the Home app -
    // only with button navigation (see usesGestureNav).
    if (KidsPrefs.prevHome(this).isEmpty() && !usesGestureNav(this)) {
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
    KidsPrefs.setBarLocked(this, true)   // before sending: a stray "none" later is harmless
    ShizukuManager.exec(this, listOf("cmd", "statusbar", "send-disable-flag", "statusbar-expansion", "recents")) { }
    blockPip()
  }

  /**
   * No picture-in-picture for the kids' video apps: leaving YouTube floated the video over the
   * kids screen and kept it playing. Each app's current mode is saved for restorePip.
   */
  private fun blockPip() {
    val apps = KidsPrefs.allowed(this).filter { SAFE_PKG.matches(it) && isPipApp(it) }
    if (apps.isEmpty()) return
    val script = apps.joinToString("; ") { p ->
      "m=\$(appops get $p PICTURE_IN_PICTURE | sed -n 's/.*PICTURE_IN_PICTURE: \\([a-z]*\\).*/\\1/p'); " +
        "[ \"\$m\" = ignore ] || { appops set $p PICTURE_IN_PICTURE ignore && echo \"$p=\${m:-default}\"; }"
    }
    ShizukuManager.exec(this, listOf("sh", "-c", "$script; true")) { out ->
      val changed = out.orEmpty().lines().mapNotNull { line ->
        val (p, m) = line.removePrefix("ERR: ").trim().split("=").takeIf { it.size == 2 } ?: return@mapNotNull null
        if (p in apps) p to m else null
      }.toMap()
      // Kept from an earlier session that couldn't restore: those already read "ignore" now.
      if (changed.isNotEmpty()) KidsPrefs.setPipRestore(this, KidsPrefs.pipRestore(this) + changed)
    }
  }

  private fun isPipApp(pkg: String): Boolean = pipApps.getOrPut(pkg) { supportsPip(this, pkg) }

  /**
   * Remember the kids apps used (closed on unlock), and close a video app the kid just left
   * (PRO) - YouTube kept playing in the background otherwise. A sign-in or permission popup
   * over the app isn't leaving it, and neither is a call.
   */
  private fun noteForeground(fg: String) {
    if (fg in ALWAYS_OK) return
    val prev = inApp
    val now = if (fg != packageName && fg in KidsPrefs.allowed(this)) fg else null
    inApp = now
    if (now != null && usedNow.add(now)) KidsPrefs.setUsed(this, usedNow.toSet())
    if (prev != null && prev != fg && SAFE_PKG.matches(prev) && isPipApp(prev) && !isCallActive(this) &&
      ShizukuManager.hasPermission()
    ) {
      ShizukuManager.submit(
        this,
        // Checked again when it runs: the kid may have gone straight back in.
        { sh -> if (inApp != prev && KidsPrefs.isActive(this)) sh?.exec(listOf("sh", "-c", closeScript(prev) + "; true")) },
        { },
        { inApp != prev },
      )
    }
  }

  private val tick = object : Runnable {
    override fun run() {
      if (!isRunning) return
      try {
        check()
        if (++ticks % 6 == 0) stopWalletSwipe()
        KidsAccessibilityService.instance?.let {
          it.guardShade()
          it.closePip()
        }
      } catch (e: Exception) {
      }
      handler?.postDelayed(this, POLL_MS)
    }
  }

  /** Called by [KidsAccessibilityService] on every window change: check without waiting. */
  fun checkSoon() {
    val h = handler ?: return
    h.postDelayed(::safeCheck, 150)
    h.postDelayed(::safeCheck, 450)
  }

  private fun safeCheck() {
    if (!isRunning) return
    try {
      check()
    } catch (e: Exception) {
    }
  }

  private fun check() {
    // CantosHub's own screen is showing: never keep the cover up, even if Android's
    // usage events still name the blocked app (that left kids stuck on the cover).
    if (MainActivity.resumed) {
      lastFg = packageName
      noteForeground(packageName)
      hideCover()
      return
    }
    val fg = foreground() ?: return
    noteForeground(fg)
    if (isOk(fg)) {
      hideCover()
      return
    }
    showCover()
    val now = System.currentTimeMillis()
    if (now - lastBounce > 1000) {
      lastBounce = now
      bringKidsScreen()
    }
  }

  private fun stopWalletSwipe() {
    if (!ShizukuManager.hasPermission()) return
    ShizukuManager.exec(
      this,
      listOf("sh", "-c", "pidof $WALLET >/dev/null && am force-stop $WALLET && echo STOPPED"),
    ) { out ->
      if (out?.contains("STOPPED") == true) KidsPrefs.setWalletStopped(this, true)
    }
  }

  private fun isOk(pkg: String): Boolean {
    if (pkg == packageName || pkg in ALWAYS_OK) return true
    if (pkg in KidsPrefs.allowed(this)) return true
    // Calls must always get through (also emergency calls).
    if (isCallActive(this) || Cleanup.isCallApp(pkg)) return true
    // The phone's own lock screen / PIN check used as the "forgot Kids PIN" fallback.
    if (KidsPrefs.systemAllowed(this) && (pkg.contains("settings") || pkg.contains("biometric"))) return true
    return false
  }

  private fun bringKidsScreen() {
    // The accessibility helper may always open activities; a plain service may be blocked.
    if (KidsAccessibilityService.instance?.showKidsScreen() == true) return
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
        setOnClickListener {
          bringKidsScreen()
          hideCover(force = true)
        }
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
        coverShownAt = System.currentTimeMillis()
      } catch (e: Exception) {
        cover = null
      }
    }
  }

  private fun hideCover(force: Boolean = false) {
    main.post {
      if (!force && System.currentTimeMillis() - coverShownAt < MIN_COVER_MS) return@post
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
    instance = null
    handler?.removeCallbacksAndMessages(null)
    thread?.quitSafely()
    thread = null
    handler = null
    hideCover(force = true)
    releaseSystemLock(this)
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  override fun onDestroy() {
    isRunning = false
    if (instance === this) instance = null
    handler?.removeCallbacksAndMessages(null)
    thread?.quitSafely()
    hideCover(force = true)
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
