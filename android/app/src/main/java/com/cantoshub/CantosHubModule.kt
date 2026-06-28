package com.cantoshub

import android.app.ActivityManager
import android.app.AppOpsManager
import android.app.NotificationManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.net.Uri
import android.util.Base64
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt
import org.json.JSONObject
import rikka.shizuku.Shizuku

/**
 * RN bridge for CantosHub. Exposes permission status/launchers, live telemetry,
 * boost service control, and quick toggle setters (no-root), plus the optional
 * Shizuku "Pro" tier (owner-authorized ADB-level access — still no root).
 */
class CantosHubModule(private val ctx: ReactApplicationContext) :
  ReactContextBaseJavaModule(ctx) {

  override fun getName() = "CantosHub"

  private var shizukuPromise: Promise? = null
  private val shizukuPermListener =
    Shizuku.OnRequestPermissionResultListener { requestCode, grantResult ->
      if (requestCode == SHIZUKU_REQ) {
        shizukuPromise?.resolve(grantResult == PackageManager.PERMISSION_GRANTED)
        shizukuPromise = null
      }
    }

  init {
    try {
      Shizuku.addRequestPermissionResultListener(shizukuPermListener)
    } catch (e: Exception) {
      // Shizuku not present yet; status calls will just report unavailable.
    }
  }

  override fun invalidate() {
    try {
      Shizuku.removeRequestPermissionResultListener(shizukuPermListener)
    } catch (e: Exception) {
    }
    super.invalidate()
  }

  companion object {
    private const val SHIZUKU_REQ = 4001
  }

  // --- Permissions ---
  @ReactMethod
  fun getPermissionStatus(promise: Promise) {
    try {
      val m = Arguments.createMap()
      m.putBoolean("usageAccess", hasUsageAccess())
      m.putBoolean("writeSettings", Settings.System.canWrite(ctx))
      m.putBoolean("dndAccess", hasDndAccess())
      m.putBoolean("overlay", Settings.canDrawOverlays(ctx))
      m.putBoolean("ignoreBatteryOptimizations", isIgnoringBattery())
      m.putBoolean("notifications", hasNotifications())
      promise.resolve(m)
    } catch (e: Exception) {
      promise.reject("PERM_ERR", e)
    }
  }

  @ReactMethod
  fun openPermissionSettings(which: String) {
    val pkg = "package:${ctx.packageName}"
    val intent = when (which) {
      "usageAccess" -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
      "writeSettings" -> Intent(Settings.ACTION_MANAGE_WRITE_SETTINGS, Uri.parse(pkg))
      "dndAccess" -> Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
      "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse(pkg))
      "ignoreBatteryOptimizations" ->
        Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse(pkg))
      "notifications" -> notificationSettingsIntent()
      else -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse(pkg))
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    try {
      ctx.startActivity(intent)
    } catch (e: Exception) {
      val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse(pkg))
      fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(fallback)
    }
  }

  private fun notificationSettingsIntent(): Intent {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
        .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
    } else {
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${ctx.packageName}"))
    }
  }

  // --- Telemetry ---
  @ReactMethod
  fun getTelemetry(promise: Promise) {
    try {
      val m = Arguments.createMap()
      val bm = ctx.getSystemService(Context.BATTERY_SERVICE) as BatteryManager
      m.putInt("batteryLevel", bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY))

      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val mi = ActivityManager.MemoryInfo()
      am.getMemoryInfo(mi)
      m.putDouble("totalMem", mi.totalMem.toDouble())
      m.putDouble("availMem", mi.availMem.toDouble())
      m.putBoolean("lowMemory", mi.lowMemory)

      val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
      val thermal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) pm.currentThermalStatus else -1
      m.putInt("thermalStatus", thermal)

      val fg = currentForegroundApp()
      if (fg == null) m.putNull("foregroundApp") else m.putString("foregroundApp", fg)

      promise.resolve(m)
    } catch (e: Exception) {
      promise.reject("TELEMETRY_ERR", e)
    }
  }

  // --- Boost service control ---
  @ReactMethod
  fun startBoost(profileJson: String, showOverlay: Boolean, promise: Promise) {
    try {
      val intent = Intent(ctx, BoostService::class.java).apply {
        action = BoostService.ACTION_START
        putExtra(BoostService.EXTRA_PROFILE, profileJson)
        putExtra(BoostService.EXTRA_OVERLAY, showOverlay)
      }
      startBoostService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("BOOST_START_ERR", e)
    }
  }

  @ReactMethod
  fun startAutoBoost(profilesJson: String, showOverlay: Boolean, promise: Promise) {
    try {
      val intent = Intent(ctx, BoostService::class.java).apply {
        action = BoostService.ACTION_START_AUTO
        putExtra(BoostService.EXTRA_PROFILES, profilesJson)
        putExtra(BoostService.EXTRA_OVERLAY, showOverlay)
      }
      startBoostService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("BOOST_AUTO_ERR", e)
    }
  }

  /** Undo any settings left applied if the app was killed mid-boost. Idempotent. */
  @ReactMethod
  fun reconcile(promise: Promise) {
    try {
      if (!BoostService.isRunning) {
        BoostActions.revert(ctx)
        ShizukuActions.revert(ctx) { }
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("RECONCILE_ERR", e)
    }
  }

  private fun startBoostService(intent: Intent) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ctx.startForegroundService(intent)
    } else {
      ctx.startService(intent)
    }
  }

  @ReactMethod
  fun stopBoost(promise: Promise) {
    try {
      val intent = Intent(ctx, BoostService::class.java).apply { action = BoostService.ACTION_STOP }
      ctx.startService(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("BOOST_STOP_ERR", e)
    }
  }

  @ReactMethod
  fun isBoostRunning(promise: Promise) {
    promise.resolve(BoostService.isRunning)
  }

  // --- Quick setters (delegate to BoostActions) ---
  @ReactMethod
  fun setDnd(enable: Boolean, promise: Promise) =
    resolveAction(promise) { BoostActions.setDnd(ctx, enable) }

  @ReactMethod
  fun setMaxBrightness(enable: Boolean, promise: Promise) =
    resolveAction(promise) { BoostActions.setMaxBrightness(ctx, enable) }

  @ReactMethod
  fun setKeepAwake(enable: Boolean, promise: Promise) =
    resolveAction(promise) { BoostActions.setKeepAwake(ctx, enable) }

  @ReactMethod
  fun setPeakRefreshRate(enable: Boolean, promise: Promise) =
    resolveAction(promise) { BoostActions.setPeakRefreshRate(ctx, enable) }

  private inline fun resolveAction(promise: Promise, block: () -> Boolean) {
    try {
      promise.resolve(block())
    } catch (e: Exception) {
      promise.reject("ACTION_ERR", e)
    }
  }

  // --- Shizuku "Pro" tier (no root) ---
  @ReactMethod
  fun getShizukuStatus(promise: Promise) {
    try {
      val available = ShizukuManager.isAvailable()
      val m = Arguments.createMap()
      m.putBoolean("available", available)
      m.putBoolean("granted", available && ShizukuManager.hasPermission())
      promise.resolve(m)
    } catch (e: Exception) {
      promise.reject("SHIZUKU_STATUS_ERR", e)
    }
  }

  @ReactMethod
  fun requestShizukuPermission(promise: Promise) {
    try {
      if (!ShizukuManager.isAvailable()) {
        promise.resolve(false)
        return
      }
      if (ShizukuManager.hasPermission()) {
        promise.resolve(true)
        return
      }
      shizukuPromise = promise
      Shizuku.requestPermission(SHIZUKU_REQ)
    } catch (e: Exception) {
      shizukuPromise = null
      promise.reject("SHIZUKU_REQ_ERR", e)
    }
  }

  @ReactMethod
  fun applyShizukuProfile(profileJson: String, promise: Promise) {
    try {
      ShizukuActions.apply(ctx, JSONObject(profileJson)) { ok -> promise.resolve(ok) }
    } catch (e: Exception) {
      promise.reject("SHIZUKU_APPLY_ERR", e)
    }
  }

  @ReactMethod
  fun revertShizukuProfile(promise: Promise) {
    try {
      ShizukuActions.revert(ctx) { ok -> promise.resolve(ok) }
    } catch (e: Exception) {
      promise.reject("SHIZUKU_REVERT_ERR", e)
    }
  }

  @ReactMethod
  fun listInstalledApps(promise: Promise) {
    try {
      val pm = ctx.packageManager
      val launchable = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val activities = pm.queryIntentActivities(launchable, 0)
      val seen = HashSet<String>()
      val arr = Arguments.createArray()
      for (ri in activities) {
        val pkg = ri.activityInfo.packageName
        if (pkg == ctx.packageName || !seen.add(pkg)) continue
        val m = Arguments.createMap()
        m.putString("packageName", pkg)
        m.putString("label", ri.loadLabel(pm).toString())
        arr.pushMap(m)
      }
      promise.resolve(arr)
    } catch (e: Exception) {
      promise.reject("LIST_APPS_ERR", e)
    }
  }

  // --- Library (Phase 3) ---
  @ReactMethod
  fun listGames(promise: Promise) {
    try {
      val pm = ctx.packageManager
      val launchable = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      val activities = pm.queryIntentActivities(launchable, 0)
      val usage = weeklyUsage()
      val seen = HashSet<String>()
      val arr = Arguments.createArray()
      for (ri in activities) {
        val ai = ri.activityInfo.applicationInfo
        val pkg = ai.packageName
        if (pkg == ctx.packageName || !seen.add(pkg)) continue
        val isGame = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
          ai.category == ApplicationInfo.CATEGORY_GAME
        } else {
          @Suppress("DEPRECATION")
          (ai.flags and ApplicationInfo.FLAG_IS_GAME) != 0
        }
        if (!isGame) continue
        val m = Arguments.createMap()
        m.putString("packageName", pkg)
        m.putString("label", ri.loadLabel(pm).toString())
        m.putDouble("totalTimeMs", (usage[pkg] ?: 0L).toDouble())
        arr.pushMap(m)
      }
      promise.resolve(arr)
    } catch (e: Exception) {
      promise.reject("LIST_GAMES_ERR", e)
    }
  }

  @ReactMethod
  fun getGameStats(promise: Promise) {
    try {
      val root = JSONObject(StatsStore.asJson(ctx))
      val m = Arguments.createMap()
      val keys = root.keys()
      while (keys.hasNext()) {
        val pkg = keys.next()
        val o = root.getJSONObject(pkg)
        val fpsCount = o.optInt("fpsCount", 0)
        val fpsSum = o.optDouble("fpsSum", 0.0)
        val stat = Arguments.createMap()
        stat.putInt("sessions", o.optInt("sessions", 0))
        stat.putInt("samples", fpsCount)
        stat.putInt("avgFps", if (fpsCount > 0) (fpsSum / fpsCount).roundToInt() else 0)
        m.putMap(pkg, stat)
      }
      promise.resolve(m)
    } catch (e: Exception) {
      promise.reject("STATS_ERR", e)
    }
  }

  // --- Cleanup: free RAM (no-root) + clear caches ---
  /**
   * Kills killable background processes of user apps to reclaim RAM. No root, no
   * Shizuku — uses KILL_BACKGROUND_PROCESSES. Android may relaunch apps later, so
   * the headroom is temporary; we report the actual availMem delta, not a guess.
   */
  @ReactMethod
  fun freeRam(promise: Promise) {
    Thread {
      try {
        val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
        val mi = ActivityManager.MemoryInfo()
        am.getMemoryInfo(mi)
        val before = mi.availMem
        val mine = ctx.packageName
        val fg = currentForegroundApp()
        val pm = ctx.packageManager
        val launchable = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val seen = HashSet<String>()
        var targeted = 0
        for (ri in pm.queryIntentActivities(launchable, 0)) {
          val p = ri.activityInfo.packageName
          if (p == mine || p == fg || !seen.add(p)) continue
          try {
            am.killBackgroundProcesses(p)
            targeted++
          } catch (e: Exception) {
          }
        }
        Thread.sleep(1000)
        am.getMemoryInfo(mi)
        val after = mi.availMem
        val m = Arguments.createMap()
        m.putDouble("freedBytes", (after - before).coerceAtLeast(0L).toDouble())
        m.putInt("targeted", targeted)
        m.putDouble("availMem", after.toDouble())
        m.putDouble("totalMem", mi.totalMem.toDouble())
        promise.resolve(m)
      } catch (e: Exception) {
        promise.reject("FREE_RAM_ERR", e)
      }
    }.start()
  }

  /**
   * Clears CantosHub's own cache always; with Shizuku, also trims every app's
   * cache system-wide (`pm trim-caches`). Without Shizuku, other apps' caches
   * can't be touched without root, so only our own is cleared.
   */
  @ReactMethod
  fun clearCaches(promise: Promise) {
    Thread {
      try {
        var freed = deleteDirContents(ctx.cacheDir)
        ctx.externalCacheDir?.let { freed += deleteDirContents(it) }
        var systemTrim = false
        if (ShizukuManager.hasPermission()) {
          val latch = java.util.concurrent.CountDownLatch(1)
          ShizukuManager.exec(ctx, listOf("pm", "trim-caches", "9999999999999")) { latch.countDown() }
          latch.await(8, java.util.concurrent.TimeUnit.SECONDS)
          systemTrim = true
        }
        val m = Arguments.createMap()
        m.putDouble("ownFreedBytes", freed.toDouble())
        m.putBoolean("systemTrim", systemTrim)
        promise.resolve(m)
      } catch (e: Exception) {
        promise.reject("CLEAR_CACHE_ERR", e)
      }
    }.start()
  }

  private fun deleteDirContents(dir: java.io.File): Long {
    val files = dir.listFiles() ?: return 0L
    var total = 0L
    for (f in files) {
      total += if (f.isDirectory) {
        val sub = deleteDirContents(f)
        f.delete()
        sub
      } else {
        val s = f.length()
        if (f.delete()) s else 0L
      }
    }
    return total
  }

  @ReactMethod
  fun getAppIcon(packageName: String, promise: Promise) {
    try {
      val icon = ctx.packageManager.getApplicationIcon(packageName)
      val bmp = drawableToBitmap(icon, 96)
      val baos = ByteArrayOutputStream()
      bmp.compress(Bitmap.CompressFormat.PNG, 100, baos)
      val b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
      promise.resolve("data:image/png;base64,$b64")
    } catch (e: Exception) {
      promise.resolve(null)
    }
  }

  private fun drawableToBitmap(drawable: Drawable, size: Int): Bitmap {
    if (drawable is BitmapDrawable && drawable.bitmap != null) {
      return Bitmap.createScaledBitmap(drawable.bitmap, size, size, true)
    }
    val bmp = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bmp)
    drawable.setBounds(0, 0, size, size)
    drawable.draw(canvas)
    return bmp
  }

  @ReactMethod
  fun launchApp(packageName: String, promise: Promise) {
    try {
      val intent = ctx.packageManager.getLaunchIntentForPackage(packageName)
      if (intent == null) {
        promise.resolve(false)
        return
      }
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      ctx.startActivity(intent)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("LAUNCH_ERR", e)
    }
  }

  // --- In-app updater ---
  @ReactMethod
  fun getVersionInfo(promise: Promise) {
    try {
      val pInfo = ctx.packageManager.getPackageInfo(ctx.packageName, 0)
      val code = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        pInfo.longVersionCode.toInt()
      } else {
        @Suppress("DEPRECATION")
        pInfo.versionCode
      }
      val m = Arguments.createMap()
      m.putInt("versionCode", code)
      m.putString("versionName", pInfo.versionName ?: "")
      promise.resolve(m)
    } catch (e: Exception) {
      promise.reject("VERSION_ERR", e)
    }
  }

  /** Downloads the APK (emitting progress) and launches the system installer. */
  @ReactMethod
  fun installUpdate(url: String, promise: Promise) {
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
        !ctx.packageManager.canRequestPackageInstalls()
      ) {
        val i = Intent(
          Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
          Uri.parse("package:${ctx.packageName}"),
        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ctx.startActivity(i)
        promise.resolve("NEEDS_PERMISSION")
        return
      }
      Thread {
        try {
          val file = downloadApk(url)
          launchInstall(file)
          promise.resolve("INSTALLING")
        } catch (e: Exception) {
          promise.reject("UPDATE_DOWNLOAD_ERR", e)
        }
      }.start()
    } catch (e: Exception) {
      promise.reject("UPDATE_ERR", e)
    }
  }

  private fun downloadApk(url: String): java.io.File {
    val file = java.io.File(ctx.getExternalFilesDir(null), "update.apk")
    val conn = java.net.URL(url).openConnection() as java.net.HttpURLConnection
    conn.instanceFollowRedirects = true
    conn.connectTimeout = 30000
    conn.readTimeout = 30000
    conn.connect()
    val total = conn.contentLength
    conn.inputStream.use { input ->
      java.io.FileOutputStream(file).use { output ->
        val buf = ByteArray(8192)
        var read: Int
        var sum = 0L
        var lastPct = -1
        while (input.read(buf).also { read = it } != -1) {
          output.write(buf, 0, read)
          sum += read
          if (total > 0) {
            val pct = (sum * 100 / total).toInt()
            if (pct != lastPct) {
              lastPct = pct
              emitProgress(pct)
            }
          }
        }
      }
    }
    conn.disconnect()
    return file
  }

  private fun launchInstall(file: java.io.File) {
    val uri = androidx.core.content.FileProvider.getUriForFile(
      ctx,
      "${ctx.packageName}.fileprovider",
      file,
    )
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    ctx.startActivity(intent)
  }

  private fun emitProgress(pct: Int) {
    try {
      ctx.getJSModule(
        com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java,
      ).emit("CantosHubUpdateProgress", pct)
    } catch (e: Exception) {
    }
  }

  private fun weeklyUsage(): Map<String, Long> {
    return try {
      val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val now = System.currentTimeMillis()
      val start = now - 7L * 24 * 60 * 60 * 1000
      val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_WEEKLY, start, now)
        ?: return emptyMap()
      val map = HashMap<String, Long>()
      for (s in stats) {
        map[s.packageName] = (map[s.packageName] ?: 0L) + s.totalTimeInForeground
      }
      map
    } catch (e: Exception) {
      emptyMap()
    }
  }

  // --- helpers ---
  private fun hasUsageAccess(): Boolean {
    val appOps = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
    val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      appOps.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    } else {
      @Suppress("DEPRECATION")
      appOps.checkOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName)
    }
    return mode == AppOpsManager.MODE_ALLOWED
  }

  private fun hasDndAccess(): Boolean {
    val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    return nm.isNotificationPolicyAccessGranted
  }

  private fun isIgnoringBattery(): Boolean {
    val pm = ctx.getSystemService(Context.POWER_SERVICE) as PowerManager
    return pm.isIgnoringBatteryOptimizations(ctx.packageName)
  }

  private fun hasNotifications(): Boolean {
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      ctx.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS) ==
        PackageManager.PERMISSION_GRANTED
    } else {
      true
    }
  }

  private fun currentForegroundApp(): String? {
    if (!hasUsageAccess()) return null
    return try {
      val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val now = System.currentTimeMillis()
      val stats = usm.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, now - 60_000, now)
      stats?.maxByOrNull { it.lastTimeUsed }?.packageName
    } catch (e: Exception) {
      null
    }
  }
}
