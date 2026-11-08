package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.Rect
import android.graphics.RectF
import android.os.Build
import android.view.Gravity
import android.view.View
import android.view.WindowManager

/**
 * What viewers see, on the owner's own screen too: the chat, the goal, the counters… of the scene on
 * the stream, at the very place and size they have there (the stream is this screen). Only drawn,
 * never touched: every touch goes to the game. Main thread.
 */
class OwnerMirror(private val ctx: Context) {

    /** One picture of the scene, placed like on the stream (centre as fractions of the screen). */
    class Item(
        val kind: Scenes.Kind, val bmp: Bitmap, val x: Float, val y: Float, val dy: Float, val scale: Float, val rot: Float,
        val crop: FloatArray, val alpha: Float, val corner: Float,
        /** A text with live numbers (viewers, subscribers…): the chat panel's own number line steps aside. */
        val numbers: Boolean,
    )

    private val wm = ctx.getSystemService(WindowManager::class.java)
    private var items: List<Item> = emptyList()
    var shown = false; private set

    @SuppressLint("ViewConstructor")
    private val view = object : View(ctx) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        private val real = Point()
        private val loc = IntArray(2)
        override fun onDraw(c: Canvas) {
            val list = items
            if (list.isEmpty()) return
            @Suppress("DEPRECATION") (display ?: wm?.defaultDisplay)?.getRealSize(real) ?: return
            getLocationOnScreen(loc)
            val fw = real.x.toFloat(); val fh = real.y.toFloat()
            if (fw <= 0f || fh <= 0f) return
            val unit = minOf(fw, fh) / 1080f
            for (it in list) {
                val (nw, nh) = Scenes.fit(it.bmp.width.toFloat(), it.bmp.height.toFloat(), fw / unit)
                val cr = it.crop
                val sw = nw * (cr[2] - cr[0]) * it.scale * unit
                val sh = nh * (cr[3] - cr[1]) * it.scale * unit
                if (sw < 1f || sh < 1f) continue
                c.save()
                c.translate(it.x * fw - loc[0], it.y * fh - loc[1] + it.dy * unit)
                c.rotate(it.rot)
                val dst = RectF(-sw / 2, -sh / 2, sw / 2, sh / 2)
                val r = minOf(it.corner * it.scale * unit, minOf(sw, sh) / 2)
                if (r > 0f) c.clipPath(Path().apply { addRoundRect(dst, r, r, Path.Direction.CW) })
                paint.alpha = (255 * it.alpha).toInt().coerceIn(0, 255)
                val b = it.bmp
                c.drawBitmap(b, Rect((cr[0] * b.width).toInt(), (cr[1] * b.height).toInt(), (cr[2] * b.width).toInt(), (cr[3] * b.height).toInt()), dst, paint)
                c.restore()
            }
        }
    }

    private val lp = WindowManager.LayoutParams(
        WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
        WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
        WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
            WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.LEFT
        layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= 30) WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
            else WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        // Android 12+ lets a touch through a window of another app only up to this opacity
        alpha = OverlayWindows.passThroughAlpha(ctx)
        title = "RawRec mirror"
    }

    fun show() {
        if (shown) return
        try { OverlayWindows.add(wm, view, lp); shown = true } catch (_: Exception) { shown = false }
    }

    fun hide() {
        if (!shown) return
        OverlayWindows.remove(wm, view)
        shown = false
    }

    fun set(list: List<Item>) {
        items = list
        if (shown) view.invalidate()
    }

    internal val viewForTests: View get() = view
}
