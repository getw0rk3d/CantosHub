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

  /**
   * Shell commands can run: Shizuku is granted, or our own shell service is still alive (it
   * outlives a stopped Shizuku server). For undoing things - a Kids top bar or frozen apps
   * shouldn't stay stuck just because the Shizuku server went away first.
   */
  fun canRun(): Boolean = hasPermission() || try {
    synchronized(lock) { service }?.asBinder()?.pingBinder() == true
  } catch (e: Exception) {
    false
  }

  private fun appVersion(ctx: Context): Int = try {
    @Suppress("DEPRECATION")
    ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionCode
  } catch (e: Exception) {
    1
  }

  private fun userServiceArgs(ctx: Context): Shizuku.UserServiceArgs =
    Shizuku.UserServiceArgs(ComponentName(ctx.packageName, UserService::class.java.name))
      .daemon(true)
      .processNameSuffix("shizuku")
      .debuggable(false)
      // Per app version: after an update Shizuku replaces the running service (a daemon, it
      // outlives the app) instead of reusing the old one with the old code.
      .version(appVersion(ctx))

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
  @Volatile private var workerThread: Thread? = null
  private val worker = Executors.newSingleThreadExecutor { r ->
    Thread(r, "cantoshub-shizuku").apply { isDaemon = true }.also { workerThread = it }
  }

  /**
   * The user service, binding it first if needed (on the worker only: it waits for the bind,
   * whose reply comes on the main thread). Null without Shizuku.
   */
  private fun awaitService(ctx: Context): IUserService? {
    val latch = CountDownLatch(1)
    var svc: IUserService? = null
    withService(ctx) { s ->
      svc = s
      latch.countDown()
    }
    latch.await(10_000, TimeUnit.MILLISECONDS)
    return svc
  }

  private fun execNow(ctx: Context, command: List<String>): String? {
    val svc = awaitService(ctx) ?: return null
    return try {
      svc.exec(ArrayList(command))
    } catch (e: Exception) {
      null
    }
  }

  // Everything queues on the worker as soon as it's asked for - waiting for the bind there, not
  // before - so commands run in exactly the order they were requested.
  private fun run(ctx: Context, command: List<String>, deliver: (Runnable) -> Unit, cb: (String?) -> Unit) {
    worker.execute {
      val out = execNow(ctx, command)
      deliver(Runnable { cb(out) })
    }
  }

  /** Runs commands inside a [submit] job, one after another; null on failure. */
  class Shell internal constructor(private val svc: IUserService) {
    fun exec(command: List<String>): String? = try {
      svc.exec(ArrayList(command))
    } catch (e: Exception) {
      null
    }
  }

  /**
   * Run [job] as ONE task on the worker (shell is null without Shizuku), then hand its result
   * to the caller's looper. Jobs never interleave and run in the order submitted, so a revert
   * queued before an apply has finished - and saved its record - when the apply starts. With
   * separate callbacks the two used to cross: on an Auto game-to-game switch the old game's
   * revert wiped the new game's freeze record, leaving those apps frozen for good.
   */
  fun <T> submit(ctx: Context, job: (Shell?) -> T, cb: (T) -> Unit) {
    val replyTo = Handler(Looper.myLooper() ?: Looper.getMainLooper())
    worker.execute {
      val result = try {
        job(awaitService(ctx)?.let { Shell(it) })
      } catch (e: Exception) {
        return@execute
      }
      replyTo.post { cb(result) }
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
    // On the worker itself (inside a job), queueing would wait on ourselves forever.
    if (Thread.currentThread() === workerThread) return execNow(ctx, command)
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
