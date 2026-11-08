package com.vil3ntec.rawrec

import android.content.Context

/**
 * Where each thing viewers see sits on the stream, as the owner arranged it by dragging in
 * «چیدمانِ پخش»: its centre as fractions of the frame (0…1 from the top-left) and its size.
 * Whether it is shown at all is the «در پخش» switch of the same thing (the keys of
 * [ChatHud.ON_STREAM]), so the eye in the editor and the eye on the chat panel are one switch.
 */
object OverlayLayout {

    class Item(val key: String, val showKey: String, val name: Int, val defX: Float, val defY: Float)
    class Place(val x: Float, val y: Float, val scale: Float)

    const val CHAT = "chat"
    const val GOAL = "goal"
    const val SUBS = "subs"
    const val VIEWERS = "viewers"
    const val ALERT = "alert"

    /** Defaults keep the corners of most game screens free: counters top-left, alerts top-centre, chat and goal at the left. */
    val ITEMS = listOf(
        Item(ALERT, ChatHud.ON_ALERTS, R.string.lay_alert, 0.5f, 0.11f),
        Item(SUBS, ChatHud.ON_SUBS, R.string.lay_subs, 0.10f, 0.05f),
        Item(VIEWERS, ChatHud.ON_VIEWERS, R.string.lay_viewers, 0.25f, 0.05f),
        Item(GOAL, ChatHud.ON_GOAL, R.string.lay_goal, 0.18f, 0.92f),
        Item(CHAT, ChatHud.ON_CHAT, R.string.lay_chat, 0.18f, 0.62f),
    )

    fun item(key: String) = ITEMS.first { it.key == key }

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE)

    fun place(ctx: Context, key: String): Place {
        val it = item(key)
        val s = SafePrefs.str(prefs(ctx), "lay_$key").split(',')
        val x = s.getOrNull(0)?.toFloatOrNull() ?: it.defX
        val y = s.getOrNull(1)?.toFloatOrNull() ?: it.defY
        val k = s.getOrNull(2)?.toFloatOrNull() ?: 1f
        return Place(x.coerceIn(0f, 1f), y.coerceIn(0f, 1f), k.coerceIn(MIN_SCALE, MAX_SCALE))
    }

    fun setPlace(ctx: Context, key: String, p: Place) {
        prefs(ctx).edit().putString("lay_$key", "${p.x},${p.y},${p.scale}").apply()
    }

    fun shown(ctx: Context, key: String) = LiveExtras.onStream(ctx, item(key).showKey)
    fun setShown(ctx: Context, key: String, on: Boolean) = LiveExtras.put(ctx, item(key).showKey, on)

    fun reset(ctx: Context) {
        val e = prefs(ctx).edit()
        for (it in ITEMS) e.remove("lay_${it.key}")
        e.apply()
    }

    const val MIN_SCALE = 0.5f
    const val MAX_SCALE = 2.2f
}
