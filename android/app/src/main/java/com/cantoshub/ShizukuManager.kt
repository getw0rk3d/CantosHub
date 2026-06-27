package com.cantoshub

import android.content.ComponentName
import android.content.Context
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.IBinder
import rikka.shizuku.Shizuku

/**
 * Thin wrapper over the Shizuku API. Handles availability/permission and lazily
 * binds a persistent (daemon) [UserService] so we can run shell-level commands.
 *
 * No root anywhere — Shizuku itself is started by the owner (wireless debugging
 * or a one-off ADB command) and every privileged action stays at shell level.
 */
object ShizukuManager {
  private var service: IUserService? = null
  private var binding = false
  private val pending = ArrayList<(IUserService?) -> Unit>()

  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
      service = if (binder != null && binder.pingBinder()) {
        IUserService.Stub.asInterface(binder)
      } else {
        null
      }
      binding = false
      val copy = ArrayList(pending)
      pending.clear()
      copy.forEach { it(service) }
    }

    override fun onServiceDisconnected(name: ComponentName?) {
      service = null
    }
  }

  fun isAvailable(): Boolean = try {
    Shizuku.pingBinder()
  } catch (e: Exception) {
    false
  }

  fun hasPermission(): Boolean = try {
    isAvailable() && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED
  } catch (e: Exception) {
    false
  }

  private fun userServiceArgs(ctx: Context): Shizuku.UserServiceArgs =
    Shizuku.UserServiceArgs(ComponentName(ctx.packageName, UserService::class.java.name))
      .daemon(true)
      .processNameSuffix("shizuku")
      .debuggable(false)
      .version(1)

  private fun withService(ctx: Context, cb: (IUserService?) -> Unit) {
    val current = service
    if (current != null) {
      cb(current)
      return
    }
    if (!hasPermission()) {
      cb(null)
      return
    }
    pending.add(cb)
    if (!binding) {
      binding = true
      try {
        Shizuku.bindUserService(userServiceArgs(ctx.applicationContext), connection)
      } catch (e: Exception) {
        binding = false
        val copy = ArrayList(pending)
        pending.clear()
        copy.forEach { it(null) }
      }
    }
  }

  /** Run a shell command (argv) and deliver the combined output (null on failure). */
  fun exec(ctx: Context, command: List<String>, cb: (String?) -> Unit) {
    withService(ctx) { svc ->
      if (svc == null) {
        cb(null)
        return@withService
      }
      try {
        cb(svc.exec(ArrayList(command)))
      } catch (e: Exception) {
        cb(null)
      }
    }
  }
}
