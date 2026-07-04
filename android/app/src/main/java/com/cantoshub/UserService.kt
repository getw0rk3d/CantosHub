package com.cantoshub

import android.content.Context

/**
 * Runs inside a process started by Shizuku at ADB (shell) privilege level — NOT
 * root. Whatever it execs therefore runs as shell, which is enough for
 * `wm size` / `wm density` / `pm suspend` etc. Bound via Shizuku.bindUserService.
 */
class UserService() : IUserService.Stub() {

  // Shizuku may instantiate with a Context; keep both constructors.
  constructor(context: Context) : this()

  override fun destroy() {
    System.exit(0)
  }

  override fun exit() {
    destroy()
  }

  override fun exec(command: MutableList<String>): String {
    return try {
      val process = Runtime.getRuntime().exec(command.toTypedArray())
      val out = process.inputStream.bufferedReader().readText()
      val err = process.errorStream.bufferedReader().readText()
      val code = process.waitFor()
      val combined = (out + err).trim()
      // Non-zero exit = the command (e.g. `pm`) failed even though the JVM didn't
      // throw. Prefix with ERR so callers (booster/hide/unhide) detect real failure.
      if (code != 0) "ERR: $combined" else combined
    } catch (e: Exception) {
      "ERR: ${e.message}"
    }
  }
}
