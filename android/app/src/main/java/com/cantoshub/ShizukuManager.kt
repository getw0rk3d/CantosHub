package com.cantoshub

import android.content.ComponentName
import android.content.Context
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import rikka.shizuku.Shizuku

/**
 * Thin wrapper over the Shizuku API. Handles availability/permission and lazily
 * binds a persistent (daemon) [UserService] so we can run shell-level commands.
 *
 * No root anywhere — Shizuku itself is started by the owner (wireless debugging
 * or a one-off ADB command) and every privileged action stays at shell level.
 */
object ShizukuManager {
  private val lock = Any()
  private var service: IUserService? = null
  private var binding = false
  private val pending = ArrayList<(IUserService?) -> Unit>()

  private val connection = object : ServiceConnection {
    override fun onServiceConnected(name: ComponentName?, binder: IBinder?) {
      val svc = if (binder != null && binder.pingBinder()) {
        IUserService.Stub.asInterface(binder)
      } else {
        null
      }
      val copy = synchronized(lock) {
        service = svc
        binding = false
        val c = ArrayList(pending)
        pending.clear()
        c
      }
      copy.forEach { it(svc) }
    }

    override fun onServiceDisconnected(name: ComponentName?) {
      synchronized(lock) { service = null }
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
    val current = synchronized(lock) { service }
    if (current != null) {
      cb(current)
      return
    }
    if (!hasPermission()) {
      cb(null)
      return
    }
    val doBind = synchronized(lock) {
      pending.add(cb)
      if (!binding) {
        binding = true
        true
      } else {
        false
      }
    }
    if (doBind) {
      try {
        Shizuku.bindUserService(userServiceArgs(ctx.applicationContext), connection)
      } catch (e: Exception) {
        val copy = synchronized(lock) {
          binding = false
          val c = ArrayList(pending)
          pending.clear()
          c
        }
        copy.forEach { it(null) }
      }
    }
  }

  /**
   * Shell commands run HERE, one at a time and in order (a resolution change is size then
   * density). They used to run on whichever thread asked - including the main thread when
   * the user service connected - and a slow one (cache trim, app freeze, gfxinfo) froze the
   * app: the ANR of 2026-10-21, "Input dispatching timed out" with the main thread inside
   * IUserService.exec.
   */
  private val worker = Executors.newSingleThreadExecutor { r -> Thread(r, "cantoshub-shizuku").apply { isDaemon = true } }

  private fun run(ctx: Context, command: List<String>, deliver: (Runnable) -> Unit, cb: (String?) -> Unit) {
    withService(ctx) { svc ->
      if (svc == null) {
        deliver(Runnable { cb(null) })
        return@withService
      }
      worker.execute {
        val out = try {
          svc.exec(ArrayList(command))
        } catch (e: Exception) {
          null
        }
        deliver(Runnable { cb(out) })
      }
    }
  }

  /**
   * Run a shell command (argv) off the main thread and deliver the combined output (null on
   * failure) back on the calling thread's looper (the main thread if it has none), so
   * callers keep the threading they had.
   */
  fun exec(ctx: Context, command: List<String>, cb: (String?) -> Unit) {
    val replyTo = Handler(Looper.myLooper() ?: Looper.getMainLooper())
    run(ctx, command, { replyTo.post(it) }, cb)
  }

  /** Blocking variant for callers already off the main thread; null on failure or timeout. */
  fun execBlocking(ctx: Context, command: List<String>, timeoutMs: Long): String? {
    val latch = CountDownLatch(1)
    var result: String? = null
    run(ctx, command, { it.run() }) { out ->
      result = out
      latch.countDown()
    }
    latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    return result
  }
}
