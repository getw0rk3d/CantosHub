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
      process.waitFor()
      (out + err).trim()
    } catch (e: Exception) {
      "ERR: ${e.message}"
    }
  }
}
