package com.vil3ntec.rawrec

import android.content.Context
import android.graphics.Point
import android.os.SystemClock
import android.view.MotionEvent
import android.view.WindowManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * 8.4: «ویرایشِ چیدمان» over the game — the chat and the goal moved and resized with the finger on the
 * game's own screen, the stream following at once; nothing opens RawRec.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w800dp-h400dp-land-mdpi")
class InPlaceEditorTest {
    private val ctx: Context = RuntimeEnvironment.getApplication()

    /** A scene with a chat and a locked goal; each layer 0.2 × 0.3 of the picture at scale 1. */
    private class Fake : InPlaceEditor.Target {
        val chat = Scenes.Layer("chat", Scenes.Kind.CHAT, "چت", x = 0.3f, y = 0.5f)
        val goal = Scenes.Layer("goal", Scenes.Kind.GOAL, "هدف", x = 0.8f, y = 0.2f, locked = true)
        val layers = listOf(chat, goal)
        var commits = 0; var edits = 0
        override var boxes: List<SceneRenderer.Box> = emptyList()
        override fun layerOf(id: String) = layers.firstOrNull { it.id == id }
        override fun editLayer(id: String, x: Float, y: Float, scale: Float) {
            val l = layerOf(id) ?: return
            l.x = x; l.y = y; l.scale = scale; edits++; push()
        }
        override fun commitEdit() { commits++ }
        override fun push() { boxes = layers.map { SceneRenderer.Box(it.id, it.name, it.kind, it.x, it.y, 0.2f * it.scale, 0.3f * it.scale, 0f, it.locked) } }
    }

    private var t = SystemClock.uptimeMillis()
    private fun touch(v: android.view.View, action: Int, x: Float, y: Float) {
        t += 40
        val e = MotionEvent.obtain(t, t, action, x, y, 0)
        v.dispatchTouchEvent(e); e.recycle()
    }

    @Test fun theChatIsMovedAndResizedOverTheGameAndTheStreamFollowsAtOnce() {
        val f = Fake()
        var closed = false; var full = false
        val ed = InPlaceEditor(ctx, f, geo = { null }, openFull = { full = true }, onClose = { closed = true })
        ed.show()
        assertTrue("on the screen, over the game", ed.shown)
        val real = Point(); @Suppress("DEPRECATION") ctx.getSystemService(WindowManager::class.java).defaultDisplay.getRealSize(real)
        val w = real.x.toFloat(); val h = real.y.toFloat()
        val v = ed.viewForTests

        // one finger on the chat, to the middle of the screen
        touch(v, MotionEvent.ACTION_DOWN, 0.3f * w, 0.5f * h)
        assertEquals("the chat is chosen", "chat", ed.selectedForTests)
        touch(v, MotionEvent.ACTION_MOVE, 0.4f * w, 0.5f * h)
        touch(v, MotionEvent.ACTION_UP, 0.5f * w, 0.45f * h)
        assertEquals("moved across, on the stream at once", 0.5f, f.chat.x, 0.01f)
        assertEquals("and up a little", 0.45f, f.chat.y, 0.01f)
        assertEquals("the size untouched by a move", 1f, f.chat.scale, 0.001f)
        assertTrue(f.edits >= 2)

        // the corner circle pulled to twice its distance from the centre: twice the size
        val cx = 0.5f * w; val cy = 0.45f * h
        val corner = Pair(cx + 0.1f * w, cy + 0.15f * h)
        touch(v, MotionEvent.ACTION_DOWN, corner.first, corner.second)
        touch(v, MotionEvent.ACTION_UP, cx + 0.2f * w, cy + 0.3f * h)
        assertEquals("twice as big", 2f, f.chat.scale, 0.05f)
        assertEquals("the centre stays where it was", 0.5f, f.chat.x, 0.01f)

        // the locked goal does not move
        touch(v, MotionEvent.ACTION_DOWN, 0.8f * w, 0.2f * h)
        touch(v, MotionEvent.ACTION_UP, 0.6f * w, 0.3f * h)
        assertEquals("locked: where it was", 0.8f, f.goal.x, 0.001f)

        // «برگرداندن»: everything back as it was before this edit
        ed.root().findViewWithText(ctx.getString(R.string.ipe_undo)).performClick()
        assertEquals(0.3f, f.chat.x, 0.001f); assertEquals(0.5f, f.chat.y, 0.001f); assertEquals(1f, f.chat.scale, 0.001f)

        // moved again and «تمام»: saved, the window gone, RawRec never opened
        touch(v, MotionEvent.ACTION_DOWN, 0.3f * w, 0.5f * h)
        touch(v, MotionEvent.ACTION_UP, 0.2f * w, 0.5f * h)
        ed.root().findViewWithText(ctx.getString(R.string.ipe_done)).performClick()
        assertEquals("saved once", 1, f.commits)
        assertTrue(closed); assertFalse(ed.shown); assertFalse("the full editor was not opened", full)
        assertEquals(0.2f, f.chat.x, 0.01f)
    }

    /** The views under the editor's window, to find its buttons by their text. */
    private fun InPlaceEditor.root(): android.view.View = viewForTests.rootView

    private fun android.view.View.findViewWithText(text: String): android.view.View {
        if (this is android.widget.TextView && this.text.toString() == text) return this
        if (this is android.view.ViewGroup) for (i in 0 until childCount) runCatching { return getChildAt(i).findViewWithText(text) }
        throw NoSuchElementException(text)
    }
}
