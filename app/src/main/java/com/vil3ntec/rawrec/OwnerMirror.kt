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
        /**
         * 8.5: the owner's own copy (the chat in Persian) while the whole screen is captured: drawn in a
         * window of its own that screen capture leaves out (FLAG_SECURE), so viewers get the stream's own
         * layer (the original words) there and never the owner's translation.
         */
        val secure: Boolean = false,
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
            for (it in list) if (!it.secure) drawItem(c, it, scrW, scrH, loc, paint)
        }
    }

    /** Where an item lies on the screen: centre x, y and size w, h (screen pixels), or null when too small. */
    private fun place(it: Item, scrW: Float, scrH: Float): FloatArray? {
        val m = Mapping.of(geometry?.invoke(), scrW, scrH)
        // sizes as on the stream: pixels of a frame 1080 high, then onto this screen
        val unit = minOf(m.frameW, m.frameH) / 1080f * m.px
        val (nw, nh) = Scenes.fit(it.bmp.width.toFloat(), it.bmp.height.toFloat(), m.frameW / (minOf(m.frameW, m.frameH) / 1080f))
        val cr = it.crop
        val sw = nw * (cr[2] - cr[0]) * it.scale * unit
        val sh = nh * (cr[3] - cr[1]) * it.scale * unit
        if (sw < 1f || sh < 1f) return null
        return floatArrayOf(m.x(it.x), m.y(it.y) + it.dy * unit, sw, sh, unit)
    }

    private fun drawItem(c: Canvas, it: Item, scrW: Float, scrH: Float, loc: IntArray, paint: Paint) {
        val pl = place(it, scrW, scrH) ?: return
        val sw = pl[2]; val sh = pl[3]; val unit = pl[4]
        val cr = it.crop
        c.save()
        c.translate(pl[0] - loc[0], pl[1] - loc[1])
        c.rotate(it.rot)
        val dst = RectF(-sw / 2, -sh / 2, sw / 2, sh / 2)
        val r = minOf(it.corner * it.scale * unit, minOf(sw, sh) / 2)
        if (r > 0f) c.clipPath(Path().apply { addRoundRect(dst, r, r, Path.Direction.CW) })
        paint.alpha = (255 * it.alpha).toInt().coerceIn(0, 255)
        val b = it.bmp
        c.drawBitmap(b, Rect((cr[0] * b.width).toInt(), (cr[1] * b.height).toInt(), (cr[2] * b.width).toInt(), (cr[3] * b.height).toInt()), dst, paint)
        c.restore()
    }

    /** One owner-only picture in a window screen capture leaves out ([Item.secure]). */
    @SuppressLint("ViewConstructor")
    private inner class SecureView(var item: Item) : View(ctx) {
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        private val real = Point()
        private val loc = IntArray(2)
        override fun onDraw(c: Canvas) {
            @Suppress("DEPRECATION") (display ?: wm?.defaultDisplay)?.getRealSize(real) ?: return
            getLocationOnScreen(loc)
            drawItem(c, item, real.x.toFloat(), real.y.toFloat(), loc, paint)
        }
    }

    private val secureViews = ArrayList<Pair<SecureView, WindowManager.LayoutParams>>()

    /** The secure windows follow the secure items: one each, placed and sized over it (main thread). */
    private fun syncSecure() {
        val want = if (shown) items.filter { it.secure } else emptyList()
        while (secureViews.size > want.size) { val (v, _) = secureViews.removeAt(secureViews.size - 1); OverlayWindows.remove(wm, v) }
        val real = Point()
        @Suppress("DEPRECATION") wm?.defaultDisplay?.getRealSize(real)
        for ((i, it) in want.withIndex()) {
            val pl = place(it, real.x.toFloat().coerceAtLeast(1f), real.y.toFloat().coerceAtLeast(1f)) ?: continue
            // the rotated picture's bounds, a little margin round it
            val a = Math.toRadians(it.rot.toDouble())
            val bw = (kotlin.math.abs(pl[2] * kotlin.math.cos(a)) + kotlin.math.abs(pl[3] * kotlin.math.sin(a))).toInt() + 8
            val bh = (kotlin.math.abs(pl[2] * kotlin.math.sin(a)) + kotlin.math.abs(pl[3] * kotlin.math.cos(a))).toInt() + 8
            val x = (pl[0] - bw / 2f).toInt(); val y = (pl[1] - bh / 2f).toInt()
            if (i < secureViews.size) {
                val (v, p) = secureViews[i]
                v.item = it
                if (p.x != x || p.y != y || p.width != bw || p.height != bh) { p.x = x; p.y = y; p.width = bw; p.height = bh; OverlayWindows.update(wm, v, p) }
                v.invalidate()
            } else {
                val p = WindowManager.LayoutParams(bw, bh, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                    WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                        WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
                        WindowManager.LayoutParams.FLAG_SECURE,
                    PixelFormat.TRANSLUCENT).apply {
                    gravity = Gravity.TOP or Gravity.LEFT; this.x = x; this.y = y
                    layoutInDisplayCutoutMode = lp.layoutInDisplayCutoutMode
                    alpha = lp.alpha; title = "RawRec mirror (mine)"
                }
                val v = SecureView(it)
                try { OverlayWindows.add(wm, v, p); secureViews += v to p } catch (e: Exception) { problem = "secure: " + (e.message ?: e.javaClass.simpleName).take(120) }
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

    /** Why the view could not go on the screen (for the report); null = it is there. */
    @Volatile var problem: String? = null; private set

    /**
     * On the screen. Some phones refuse a full-screen window with these flags (4.3: the owner saw
     * nothing of the layout on a tablet, and the refusal was swallowed): then plainer flags are tried,
     * and what was refused is kept for the report.
     */
    fun show() {
        if (shown) return
        try { OverlayWindows.add(wm, view, lp); shown = true; problem = null } catch (e: Exception) {
            problem = (e.javaClass.simpleName + ": " + (e.message ?: "")).take(160)
            val plain = WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE,
                PixelFormat.TRANSLUCENT,
            ).apply { gravity = Gravity.TOP or Gravity.LEFT; alpha = lp.alpha; title = lp.title }
            try { OverlayWindows.add(wm, view, plain); shown = true } catch (e2: Exception) {
                shown = false
                problem += " / " + (e2.javaClass.simpleName + ": " + (e2.message ?: "")).take(160)
            }
        }
        if (shown) view.post { view.invalidate(); syncSecure() }
    }

    fun hide() {
        if (!shown) return
        OverlayWindows.remove(wm, view)
        shown = false
        syncSecure()
    }

    /** What is drawn now (any thread: drawn on the main one). */
    fun set(list: List<Item>) {
        items = list
        if (shown) { view.postInvalidate(); view.post { syncSecure() } }
    }

    /** How many pictures it holds now (the report). */
    val count: Int get() = items.size

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
