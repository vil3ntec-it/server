package com.vil3ntec.rawrec

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Typeface
import android.text.StaticLayout
import android.text.TextPaint
import java.io.File

/**
 * YouTube «Dual stream» (Studio → Go live → Stream settings → Dual stream → Encoder): the same live
 * as a 9:16 picture too, for the Shorts feed — a second picture of its own size sent with the
 * vertical stream key. The game sits at the top, middle or bottom of the tall frame, whole or
 * bigger; above it (if there is room) the stream's title or a picture, below it the chat.
 */
object Shorts {

    val SIZES = listOf(720 to 1280, 1080 to 1920)

    /** The tall picture: its size, where and how big the game is, and what goes above / below it. */
    class Layout(val w: Int, val h: Int, val game: Rect, val top: Rect?, val bottom: Rect?)

    /**
     * Where the game goes in a [w]×[h] tall frame for a screen picture of [srcAspect] (width / height).
     * [place] 0 top, 1 middle, 2 bottom; [zoom] 0 the whole game (frame width), 1 bigger (the sides
     * cut), 2 the frame's whole height (much of the sides cut). The free parts above / below.
     */
    fun layout(w: Int, h: Int, srcAspect: Float, place: Int, zoom: Int): Layout {
        val a = srcAspect.coerceIn(0.4f, 4f)
        val gw = when (zoom) { 1 -> w * 1.4f; 2 -> h * a; else -> w.toFloat() }.coerceAtLeast(w.toFloat() * 0.5f)
        val gh = (gw / a).coerceAtMost(h.toFloat())
        val y = when (place) { 0 -> 0f; 2 -> h - gh; else -> (h - gh) / 2f }
        val x = (w - gw) / 2f
        val game = Rect(x.toInt(), y.toInt(), (x + gw).toInt(), (y + gh).toInt())
        val min = h / 20
        val top = if (game.top >= min) Rect(0, 0, w, game.top) else null
        val bottom = if (h - game.bottom >= min) Rect(0, game.bottom, w, h) else null
        return Layout(w, h, game, top, bottom)
    }

    /** What goes above the game: 0 nothing, 1 the stream's title, 2 the owner's picture. */
    fun topPicture(ctx: Context, kind: Int, area: Rect): Bitmap? {
        if (area.width() <= 0 || area.height() <= 0) return null
        return when (kind) {
            1 -> titleBitmap(LiveExtras.ytTitle(ctx).ifBlank { LiveExtras.ytChannel(ctx) }.ifBlank { "LIVE" }, area.width(), area.height())
            2 -> picture(ctx)?.let { fit(it, area.width(), area.height()) }
            else -> null
        }
    }

    fun pictureFile(ctx: Context) = File(ctx.filesDir, "shorts_top.png")
    private fun picture(ctx: Context): Bitmap? = pictureFile(ctx).takeIf { it.exists() }?.let { android.graphics.BitmapFactory.decodeFile(it.path) }

    private fun fit(src: Bitmap, w: Int, h: Int): Bitmap {
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val k = minOf(w / src.width.toFloat(), h / src.height.toFloat())
        val dw = src.width * k; val dh = src.height * k
        Canvas(out).drawBitmap(src, null, RectF((w - dw) / 2f, (h - dh) / 2f, (w + dw) / 2f, (h + dh) / 2f), Paint(Paint.FILTER_BITMAP_FLAG))
        return out
    }

    private fun titleBitmap(text: String, w: Int, h: Int): Bitmap {
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        val p = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE; typeface = Typeface.DEFAULT_BOLD; setShadowLayer(w / 120f, 0f, w / 240f, Color.argb(160, 0, 0, 0)) }
        val pad = w / 16
        var size = minOf(h * 0.32f, w / 11f)
        var lay: StaticLayout
        do {
            p.textSize = size
            lay = StaticLayout.Builder.obtain(text, 0, text.length, p, w - 2 * pad).setAlignment(android.text.Layout.Alignment.ALIGN_CENTER).setMaxLines(3).build()
            size *= 0.9f
        } while (lay.height > h - pad && size > 12f)
        c.save(); c.translate(pad.toFloat(), (h - lay.height) / 2f); lay.draw(c); c.restore()
        return out
    }

    /** The chat below the game: the latest messages that fit, newest at the bottom. */
    fun chatPicture(lines: List<Pair<String, String>>, colors: List<Int>, w: Int, h: Int): Bitmap? {
        if (w <= 0 || h <= 0) return null
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        if (lines.isEmpty()) return out
        val c = Canvas(out)
        val pad = w / 24
        val p = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textSize = w / 24f; color = Color.WHITE; setShadowLayer(w / 300f, 0f, w / 400f, Color.argb(200, 0, 0, 0)) }
        var y = h - pad.toFloat()
        for (i in lines.indices.reversed()) {
            val (name, msg) = lines[i]
            val sb = android.text.SpannableStringBuilder().append(name).append("  ").append(msg)
            sb.setSpan(android.text.style.ForegroundColorSpan(colors.getOrElse(i) { Color.rgb(255, 209, 128) }), 0, name.length, 0)
            sb.setSpan(android.text.style.StyleSpan(Typeface.BOLD), 0, name.length, 0)
            val lay = StaticLayout.Builder.obtain(sb, 0, sb.length, p, w - 2 * pad).setMaxLines(3).setEllipsize(android.text.TextUtils.TruncateAt.END).build()
            y -= lay.height + pad / 3f
            if (y < pad / 2f) break
            c.save(); c.translate(pad.toFloat(), y); lay.draw(c); c.restore()
        }
        return out
    }

    /** The settings page: the tall picture as it will go out ([screen] = the last screen picture, or a sample). */
    fun preview(ctx: Context, screen: Bitmap?, srcAspect: Float): Bitmap {
        val (w, h) = 360 to 640
        val l = layout(w, h, srcAspect, LiveSettings.shortsPlace(ctx), LiveSettings.shortsZoom(ctx))
        val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(out)
        c.drawColor(Color.BLACK)
        val p = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        if (screen != null) c.drawBitmap(screen, null, l.game, p)
        else {
            p.color = Color.rgb(46, 52, 66); c.drawRect(l.game, p)
            p.color = Color.argb(200, 255, 255, 255); p.textSize = 26f; p.textAlign = Paint.Align.CENTER
            c.drawText(ctx.getString(R.string.shorts_game), l.game.exactCenterX(), l.game.exactCenterY() + 9f, p)
        }
        l.top?.let { r -> topPicture(ctx, LiveSettings.shortsTop(ctx), r)?.let { c.drawBitmap(it, r.left.toFloat(), r.top.toFloat(), null) } }
        if (LiveSettings.shortsChat(ctx)) l.bottom?.let { r ->
            chatPicture(listOf("Ali" to "سلام! 🔥", "Sara" to "gg", "Reza" to ctx.getString(R.string.shorts_sample_msg)),
                listOf(Color.rgb(128, 216, 255), Color.rgb(255, 128, 171), Color.rgb(204, 255, 144)), r.width(), r.height())
                ?.let { c.drawBitmap(it, r.left.toFloat(), r.top.toFloat(), null) }
        }
        return out
    }
}
