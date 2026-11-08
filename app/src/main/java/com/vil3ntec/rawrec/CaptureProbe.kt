package com.vil3ntec.rawrec

import android.content.Context
import android.graphics.Color
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager

/**
 * Finds out — by looking, not guessing — whether RawRec's floating windows are in the stream.
 * Android gives no way to ask whether the owner chose «Share one app» or the whole screen, so a tiny
 * square (10 dp) flashes two colours for about a second while the GPU stage reads the captured
 * frame at the same spot. Seen there → the whole screen is captured (viewers would see the chat
 * on the phone). Many frames without it, or no frames at all while it flashes → only the game is
 * captured. Undecided after 12 s counts as «seen», so the chat is never shown to viewers by
 * mistake. Main thread.
 */
class CaptureProbe(
    private val ctx: Context,
    private val filter: LookFilter,
    private val frameW: Int,
    private val frameH: Int,
    /** True while «برمی‌گردم» covers the screen: frames then say nothing, the check waits. */
    private val covered: () -> Boolean,
    private val done: (captured: Boolean) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private val wm = ctx.getSystemService(WindowManager::class.java)
    private val size = (10 * ctx.resources.displayMetrics.density).toInt().coerceAtLeast(8)
    private val view = View(ctx).apply { setBackgroundColor(MAGENTA) }
    private var started = 0L
    private var lastFrames = -1
    private var frames = 0
    private var hitsA = 0
    private var hitsB = 0
    private var colorA = true
    private var lastFlip = 0L
    private var finished = false
    private var drawnAt = 0L

    fun start() {
        val info = DisplayInfo.read(ctx)
        val lp = WindowManager.LayoutParams(size, size, WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE, PixelFormat.OPAQUE).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            x = size; y = info.height / 2
        }
        try { OverlayWindows.add(wm, view, lp) } catch (_: Exception) { finish(true); return }
        view.post {
            if (finished) return@post
            val loc = IntArray(2)
            view.getLocationOnScreen(loc)
            // The screen is fitted into the frame, centred (how Android mirrors a display).
            val d = DisplayInfo.read(ctx)
            val s = minOf(frameW / d.width.toFloat(), frameH / d.height.toFloat())
            val ox = (frameW - d.width * s) / 2f
            val oy = (frameH - d.height * s) / 2f
            val fx = (ox + (loc[0] + size / 2f) * s) / frameW
            val fy = (oy + (loc[1] + size / 2f) * s) / frameH
            filter.probe(fx, fy)
            started = System.currentTimeMillis()
            lastFlip = started
            drawnAt = filter.drawn
            main.post(tick)
        }
        main.postDelayed({ finish(true) }, 12_000)
    }

    fun cancel() { if (!finished) { finished = true; cleanup() } }

    private val tick = object : Runnable {
        override fun run() {
            if (finished) return
            val now = System.currentTimeMillis()
            if (covered()) { started = now; frames = 0; hitsA = 0; hitsB = 0; drawnAt = filter.drawn; main.postDelayed(this, 100); return }
            val n = filter.probeFrames
            if (n != lastFrames) {
                lastFrames = n
                frames++
                val c = filter.probeRgb
                val r = c shr 16 and 255; val g = c shr 8 and 255; val b = c and 255
                if (r > 170 && b > 170 && g < 90) hitsA++
                if (g > 170 && r < 90 && b < 90) hitsB++
            }
            if (hitsA >= 2 && hitsB >= 2) { finish(true); return }
            if (frames >= 45 && now - started >= 1_400) { finish(false); return }
            // The flashing square changes the screen, so a whole-screen capture always gets new
            // frames; none at all for 4 s means the capture is of one app that is not drawing now.
            if (filter.drawn == drawnAt && now - started >= 4_000) { finish(false); return }
            if (now - lastFlip >= 200) {
                lastFlip = now
                colorA = !colorA
                view.setBackgroundColor(if (colorA) MAGENTA else GREEN)
            }
            main.postDelayed(this, 25)
        }
    }

    private fun finish(captured: Boolean) {
        if (finished) return
        finished = true
        cleanup()
        done(captured)
    }

    private fun cleanup() {
        main.removeCallbacksAndMessages(null)
        filter.probe(null, null)
        OverlayWindows.remove(wm, view)
    }

    companion object {
        private val MAGENTA = Color.rgb(255, 0, 255)
        private val GREEN = Color.rgb(0, 255, 0)
    }
}
