package com.cantoshub

import android.content.Intent
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import org.json.JSONObject

/**
 * Quick Settings tile: one tap toggles a boost (the favorite profile, or Auto) —
 * no need to open the app. Reflects whether a boost is currently running.
 */
class BoostTileService : TileService() {
  override fun onStartListening() {
    super.onStartListening()
    render(BoostService.isRunning)
  }

  override fun onClick() {
    super.onClick()
    val starting = !BoostService.isRunning
    if (starting) {
      // Auto mode if the app is in Auto, else the favorite profile as it is today.
      BoostService.startFromOutside(this, QuickPrefs.favorite(this) ?: JSONObject())
    } else {
      startService(Intent(this, BoostService::class.java).apply { action = BoostService.ACTION_STOP })
    }
    render(starting) // optimistic; corrected on next onStartListening
  }

  private fun render(active: Boolean) {
    val tile = qsTile ?: return
    tile.state = if (active) Tile.STATE_ACTIVE else Tile.STATE_INACTIVE
    tile.label = "Game Boost"
    tile.updateTile()
  }
}
