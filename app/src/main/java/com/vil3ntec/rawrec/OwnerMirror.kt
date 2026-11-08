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

    /**
     * How the stream's picture lies on this screen: its size and the part of the captured screen it
     * shows ([region]: x, y from the bottom, width, height — black bars cut, see LookFilter). The
     * screen is fitted whole into the capture, so an upright tablet is a narrow strip in a wide
     * picture: without this the owner's chat and counts landed in the wrong place (4.2).
     */
    class Geo(val frameW: Int, val frameH: Int, val region: FloatArray)

    /** The stream's geometry now (null = the stream is this screen exactly). */
    var geometry: (() -> Geo?)? = null

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
            val scrW = real.x.toFloat(); val scrH = real.y.toFloat()
            if (scrW <= 0f || scrH <= 0f) return
            val m = Mapping.of(geometry?.invoke(), scrW, scrH)
            // sizes as on the stream: pixels of a frame 1080 high, then onto this screen
            val unit = minOf(m.frameW, m.frameH) / 1080f * m.px
            for (it in list) {
                val (nw, nh) = Scenes.fit(it.bmp.width.toFloat(), it.bmp.height.toFloat(), m.frameW / (minOf(m.frameW, m.frameH) / 1080f))
                val cr = it.crop
                val sw = nw * (cr[2] - cr[0]) * it.scale * unit
                val sh = nh * (cr[3] - cr[1]) * it.scale * unit
                if (sw < 1f || sh < 1f) continue
                c.save()
                c.translate(m.x(it.x) - loc[0], m.y(it.y) - loc[1] + it.dy * unit)
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

    /**
     * From the stream's picture to this screen: a point at ([fx], [fy]) of the picture (y from the
     * top) is at [x] / [y] on the screen; one picture pixel is [px] screen pixels.
     */
    class Mapping(val frameW: Float, val frameH: Float, private val r: FloatArray, private val k: Float, private val ox: Float, private val oy: Float) {
        val px: Float get() = r[2] / k
        fun x(fx: Float) = ((r[0] + fx * r[2]) * frameW - ox) / k
        fun y(fy: Float) = ((1f - (r[1] + (1f - fy) * r[3])) * frameH - oy) / k

        companion object {
            fun of(g: Geo?, scrW: Float, scrH: Float): Mapping {
                if (g == null || g.frameW <= 0 || g.frameH <= 0) return Mapping(scrW, scrH, floatArrayOf(0f, 0f, 1f, 1f), 1f, 0f, 0f)
                val fw = g.frameW.toFloat(); val fh = g.frameH.toFloat()
                // the screen is fitted whole into the captured picture, in the middle
                val k = minOf(fw / scrW, fh / scrH)
                return Mapping(fw, fh, g.region, k, (fw - scrW * k) / 2f, (fh - scrH * k) / 2f)
            }
        }
    }
}
