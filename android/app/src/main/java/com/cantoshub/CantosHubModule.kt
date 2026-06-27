package com.cantoshub

import android.app.ActivityManager
import android.app.AppOpsManager
import android.app.NotificationManager
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
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
  fun startBoost(profileJson: String, promise: Promise) {
    try {
      val intent = Intent(ctx, BoostService::class.java).apply {
        action = BoostService.ACTION_START
        putExtra(BoostService.EXTRA_PROFILE, profileJson)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("BOOST_START_ERR", e)
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
