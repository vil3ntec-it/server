package com.vil3ntec.rawrec

import android.content.Context
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import java.time.Duration

/**
 * The floating recording control (1.5): every button, delete confirm, hide, collapse/expand,
 * drag-and-snap, and «start as a dot» — a small visible dot, never an invisible hotspot, and no
 * hidden double-tap / long-press gesture that stops or pauses the recording.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 33, 34, 35])
class PillTest {
    private val app: Context get() = RuntimeEnvironment.getApplication()
    private fun idle() = shadowOf(Looper.getMainLooper()).idle()

    private class Calls : FloatingControl.Actions {
        val n = HashMap<String, Int>()
        private fun inc(k: String) { n[k] = (n[k] ?: 0) + 1 }
        override fun stop() = inc("stop")
        override fun pauseToggle() = inc("pause")
        override fun micToggle() = inc("mic")
        override fun camToggle() = inc("cam")
        override fun delete() = inc("delete")
        override fun hideControl() = inc("hide")
        operator fun get(k: String) = n[k] ?: 0
    }

    @Before fun phone() { RuntimeEnvironment.setQualifiers("w411dp-h914dp-560dpi") }

    private fun all(v: View, out: MutableList<View> = ArrayList()): MutableList<View> {
        out += v
        if (v is ViewGroup) for (i in 0 until v.childCount) all(v.getChildAt(i), out)
        return out
    }
    private fun find(f: FloatingControl, tag: String) = all(f.root).firstOrNull { it.tag == tag && it.isShown }

    /** A finger tap at the view's centre, dispatched through the overlay window's root. */
    private fun tap(f: FloatingControl, v: View, holdMs: Long = 40) {
        val (x, y) = centre(f, v)
        tapAt(f, x, y, holdMs)
    }

    private fun centre(f: FloatingControl, v: View): Pair<Float, Float> {
        val lr = IntArray(2); f.root.getLocationInWindow(lr)
        val lv = IntArray(2); v.getLocationInWindow(lv)
        return ((lv[0] - lr[0]) + v.width / 2f) to ((lv[1] - lr[1]) + v.height / 2f)
    }

    /** A tap at a fixed point of the overlay window, whatever is drawn there now. */
    private fun tapAt(f: FloatingControl, x: Float, y: Float, holdMs: Long = 40) {
        val t = SystemClock.uptimeMillis()
        f.root.dispatchTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x, y, 0))
        if (holdMs > 100) shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(holdMs))
        f.root.dispatchTouchEvent(MotionEvent.obtain(t, t + holdMs, MotionEvent.ACTION_UP, x, y, 0))
        idle()
    }

    private fun shown(startMinimized: Boolean = false): Pair<FloatingControl, Calls> {
        val c = Calls()
        val f = FloatingControl(app, startMinimized, c)
        f.show(); idle()
        return f to c
    }

    @Test fun everyButtonActsAndIsAtLeast48dp() {
        val (f, c) = shown()
        f.setRecording(true); idle()
        val min = (48 * app.resources.displayMetrics.density).toInt()
        for (k in listOf("stop", "pause", "mic", "cam")) {
            val v = find(f, "pill:$k")!!
            assertTrue("$k ≥ 48dp", v.width >= min && v.height >= min)
            tap(f, v)
            assertEquals("$k pressed once", 1, c[k])
        }
        f.hide()
    }

    @Test fun deleteNeedsASecondTap() {
        val (f, c) = shown()
        f.setRecording(true); idle()
        tap(f, find(f, "pill:delete")!!)
        assertTrue(f.armed); assertEquals(0, c["delete"])
        tap(f, find(f, "pill:delete")!!)
        assertEquals(1, c["delete"]); assertFalse(f.armed)
        // an armed delete calms down after 3 s
        tap(f, find(f, "pill:delete")!!)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(4))
        assertFalse(f.armed)
        f.hide()
    }

    @Test fun collapsesToADotAndExpands() {
        val (f, _) = shown()
        f.setRecording(true); idle()
        tap(f, find(f, "pill:timer")!!)          // tap the timer → dot
        assertFalse(f.isExpanded)
        assertTrue(find(f, "pill:dotFrame") != null)
        tap(f, find(f, "pill:dotFrame")!!)       // tap the dot → open
        assertTrue(f.isExpanded)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofSeconds(6))   // no touch for 5 s → dot
        assertFalse(f.isExpanded)
        f.hide()
    }

    @Test fun dragSnapsToTheNearestEdge() {
        val (f, _) = shown()
        assertTrue(f.onRightEdge)
        val timer = find(f, "pill:timer")!!
        val t = SystemClock.uptimeMillis()
        f.root.dispatchTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, 30f, 30f, 0).apply { setLocation(30f, 30f) })
        val down = MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, 1000f, 500f, 0)
        val move = MotionEvent.obtain(t, t + 50, MotionEvent.ACTION_MOVE, 100f, 900f, 0)
        val up = MotionEvent.obtain(t, t + 100, MotionEvent.ACTION_UP, 100f, 900f, 0)
        timer.dispatchTouchEvent(down); timer.dispatchTouchEvent(move); timer.dispatchTouchEvent(up)
        idle()
        assertFalse("snapped to the left edge", f.onRightEdge)
        assertEquals(0, f.x)
        f.hide()
    }

    /** «Start as a dot»: a visible dot at the edge; taps where it is never stop or pause the recording. */
    @Test fun startsAsAVisibleDotAndTapsNeverStop() {
        val (f, c) = shown(startMinimized = true)
        f.setRecording(true); idle()
        assertFalse("starts minimized", f.isExpanded)
        val dot = find(f, "pill:dotFrame")!!
        assertNotNull("the dot is drawn", dot.background)
        assertTrue("the dot has a size", dot.width > 0 && dot.height > 0)
        assertNotNull("its record mark shows", find(f, "pill:dot"))
        assertTrue("no invisible hotspot any more", all(f.root).none { it.tag == "pill:hotspot" })
        // 1.4: double-tap = stop. Now the first tap opens the panel, the second lands on its header.
        val (x, y) = centre(f, dot)
        tapAt(f, x, y); tapAt(f, x, y)
        assertEquals("no hidden double-tap stop", 0, c["stop"])
        assertEquals("no hidden pause", 0, c["pause"])
        // 1.4: long-press = pause. Now it only opens / closes the control.
        tapAt(f, x, y, holdMs = 900)
        assertEquals(0, c["pause"]); assertEquals(0, c["stop"])
        assertTrue("still on screen", f.root.isShown)
        f.hide()
    }

    @Test fun hideButtonTakesTheControlAway() {
        val (f, c) = shown()
        f.setRecording(true); idle()
        val h = find(f, "pill:hide")!!
        assertEquals(app.getString(R.string.eng_ctl_hide), h.contentDescription)
        tap(f, h)
        assertEquals("asks the service to hide it", 1, c["hide"])
        assertEquals(0, c["stop"])
        f.hide()
    }

    @Test fun micAndCamShowTheirState() {
        val (f, _) = shown()
        f.setMic(on = false, available = true)
        assertEquals(app.getString(R.string.pill_mic_off), find(f, "pill:mic")!!.contentDescription)
        f.setCam(on = true, available = true)
        assertEquals(app.getString(R.string.pill_cam_on), find(f, "pill:cam")!!.contentDescription)
        f.setMic(on = false, available = false)
        assertFalse(find(f, "pill:mic")!!.isEnabled)
        f.hide()
    }
}
