package com.vil3ntec.rawrec

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.PointF
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.EditText
import android.widget.TextView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowDialog
import java.io.File
import java.time.Duration
import kotlin.math.cos
import kotlin.math.sin

/** «صحنه‌ها و لایه‌ها»: what the owner puts on the stream, with the editor's real gestures and buttons. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SceneEditorTest {
    private val app: Context get() = RuntimeEnvironment.getApplication()
    private fun idle() = shadowOf(Looper.getMainLooper()).idle()
    private fun later(ms: Long) = shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(ms))

    private fun all(v: View, out: MutableList<View> = ArrayList()): MutableList<View> {
        out += v
        if (v is ViewGroup) for (i in 0 until v.childCount) all(v.getChildAt(i), out)
        return out
    }
    private fun tag(a: Activity, t: String) = all(a.window.decorView).first { it.tag == t }
    private fun button(a: Activity, text: String) = all(a.window.decorView).filterIsInstance<TextView>().first { it.text.toString() == text }

    private fun open(): SceneEditorActivity {
        RuntimeEnvironment.setQualifiers("w891dp-h411dp-land-560dpi")
        Scenes.reload(app)
        val ed = Robolectric.buildActivity(SceneEditorActivity::class.java).setup().get()
        idle()
        return ed
    }

    private fun add(ed: SceneEditorActivity, name: Int): Scenes.Layer {
        tag(ed, "sc:tab:layers").performClick(); idle()
        tag(ed, "sc:add").performClick(); idle()
        val d = ShadowDialog.getLatestDialog()
        all(d.window!!.decorView).first { it.tag == "sc:addkind:" + ed.getString(name) }.performClick()
        idle()
        return ed.layer()!!
    }

    private fun drag(v: View, x0: Float, y0: Float, x1: Float, y1: Float) {
        val t = SystemClock.uptimeMillis()
        v.dispatchTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, x0, y0, 0))
        for (i in 1..10) v.dispatchTouchEvent(MotionEvent.obtain(t, t + i * 16L, MotionEvent.ACTION_MOVE, x0 + (x1 - x0) * i / 10f, y0 + (y1 - y0) * i / 10f, 0))
        v.dispatchTouchEvent(MotionEvent.obtain(t, t + 200, MotionEvent.ACTION_UP, x1, y1, 0))
        idle()
    }

    private fun two(t: Long, action: Int, a: PointF, b: PointF): MotionEvent {
        val props = Array(2) { i -> MotionEvent.PointerProperties().apply { id = i; toolType = MotionEvent.TOOL_TYPE_FINGER } }
        val coords = arrayOf(a, b).map { p -> MotionEvent.PointerCoords().apply { x = p.x; y = p.y; pressure = 1f; size = 1f } }.toTypedArray()
        return MotionEvent.obtain(t, t, action, 2, props, coords, 0, 0, 1f, 1f, 0, 0, 0, 0)
    }

    private fun png(name: String, w: Int, h: Int): String {
        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        c.drawColor(Color.rgb(30, 120, 220))
        c.drawRect(0f, 0f, w / 2f, h / 2f, android.graphics.Paint().apply { color = Color.rgb(255, 176, 32) })
        val f = File(Scenes.mediaDir(app), name)
        f.outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return f.path
    }

    @Test fun firstRunBringsTheOldArrangementAndFourScenes() {
        val ed = open()
        val p = ed.project
        assertEquals(4, p.scenes.size)
        val game = p.current
        assertTrue("the first scene shows the game", game.game)
        for (k in listOf(Scenes.Kind.CHAT, Scenes.Kind.GOAL, Scenes.Kind.TEXT, Scenes.Kind.ALERTS))
            assertTrue("$k on the game scene", game.layers.any { it.kind == k })
        assertTrue("«برمی‌گردم» is a scene of its own", p.scene(p.away)?.game == false)
        // saved, and read back the same
        val again = Scenes.reload(app)
        assertEquals(p.toJson().toString(), again.toJson().toString())
        assertNull(CrashLog.pending(app))
    }

    @Test fun addTextDragTurnHideUndo() {
        val ed = open()
        val stage = ed.stage
        assertTrue("stage laid out", stage.width > 0 && stage.height > 0)
        val l = add(ed, R.string.sc_k_text)
        assertEquals(Scenes.Kind.TEXT, l.kind)
        assertEquals("the new layer is on top", l.id, ed.scene().layers.last().id)
        // the owner's own words, with a live number
        val field = all(ed.window.decorView).filterIsInstance<EditText>().first { it.tag == "sc:p:text" }
        field.setText("سلام {subs}")
        assertEquals("سلام {subs}", l.str("text"))
        // as YouTube gives it (rounded to three figures): short
        assertEquals("سلام 12.3K", LayerPainter.vars(l.str("text"), LayerPainter.Data().apply { subs = 12_345 }))
        // drag it 200 px to the right
        val c0 = stage.pointOf(l.id)!!
        val x0 = l.x
        drag(stage, c0.x, c0.y, c0.x + 200f, c0.y + 60f)
        assertTrue("moved: $x0 → ${l.x}", l.x > x0 + 0.05f && l.y > 0.5f)
        later(400)
        val saved = Scenes.reload(app).current.layers.first { it.id == l.id }
        assertEquals("saved a moment later", l.x, saved.x, 0.001f)
        // two fingers: twice as big, turned 30°
        val c = stage.pointOf(l.id)!!
        val s0 = l.scale
        val t = SystemClock.uptimeMillis()
        val a0 = PointF(c.x - 50f, c.y); val b0 = PointF(c.x + 50f, c.y)
        stage.dispatchTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, a0.x, a0.y, 0))
        stage.dispatchTouchEvent(two(t + 10, MotionEvent.ACTION_POINTER_DOWN or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), a0, b0))
        val r = Math.toRadians(30.0)
        val a1 = PointF(c.x - (100 * cos(r)).toFloat(), c.y - (100 * sin(r)).toFloat()); val b1 = PointF(c.x + (100 * cos(r)).toFloat(), c.y + (100 * sin(r)).toFloat())
        stage.dispatchTouchEvent(two(t + 30, MotionEvent.ACTION_MOVE, a1, b1))
        stage.dispatchTouchEvent(two(t + 50, MotionEvent.ACTION_POINTER_UP or (1 shl MotionEvent.ACTION_POINTER_INDEX_SHIFT), a1, b1))
        stage.dispatchTouchEvent(MotionEvent.obtain(t, t + 60, MotionEvent.ACTION_UP, a1.x, a1.y, 0))
        idle()
        assertEquals("pinch: size", s0 * 2f, l.scale, 0.05f)
        assertEquals("twist: rotation", 30f, l.rot, 1f)
        // hidden from viewers with the eye in the list, and back with «↶»
        tag(ed, "sc:tab:layers").performClick(); idle()
        tag(ed, "sc:eye:${l.name}").performClick(); idle()
        assertFalse(ed.project.current.layers.first { it.id == l.id }.visible)
        tag(ed, "sc:undo").performClick(); idle()
        assertTrue("undo shows it again", ed.project.current.layers.first { it.id == l.id }.visible)
        assertEquals("…and keeps the turn", 30f, ed.project.current.layers.first { it.id == l.id }.rot, 1f)
        // a tap on empty picture lets go of the layer
        stage.dispatchTouchEvent(MotionEvent.obtain(t, t + 500, MotionEvent.ACTION_DOWN, stage.width / 2f, 3f, 0))
        stage.dispatchTouchEvent(MotionEvent.obtain(t, t + 540, MotionEvent.ACTION_UP, stage.width / 2f, 3f, 0))
        idle()
        assertNull(ed.sel)
        assertNull(CrashLog.pending(app))
    }

    @Test fun cropKeepsThePictureWhereItWas() {
        val ed = open()
        val stage = ed.stage
        val l = add(ed, R.string.sc_k_image)
        l.p.put("file", png("test.png", 800, 400))
        ed.changed(structure = true); idle()
        val box = stage.boxOf(l.id)!!
        assertEquals("a picture keeps its shape", 2f, box.x / box.y, 0.02f)
        val c = stage.pointOf(l.id)!!
        val left0 = c.x - box.x / 2
        button(ed, ed.getString(R.string.sc_crop)).performClick(); idle()
        assertTrue(stage.cropping)
        // the right edge's handle a quarter to the left
        drag(stage, c.x + box.x / 2, c.y, c.x + box.x / 4, c.y)
        assertEquals("kept part", 0.75f, l.crop[2], 0.02f)
        val box1 = stage.boxOf(l.id)!!
        val c1 = stage.pointOf(l.id)!!
        assertEquals("the left side did not move", left0, c1.x - box1.x / 2, 2f)
        assertEquals(box.x * 0.75f, box1.x, 3f)
        button(ed, ed.getString(R.string.sc_crop_reset)).performClick(); idle()
        assertEquals(1f, l.crop[2], 0.001f)
        assertNull(CrashLog.pending(app))
    }

    @Test fun scenesAreAddedAndSwitched() {
        val ed = open()
        val n = ed.project.scenes.size
        val start = ed.project.start
        assertTrue("streams start with the game", ed.project.startScene.game)
        tag(ed, "sc:scene:add").performClick(); idle()
        assertEquals(n + 1, ed.project.scenes.size)
        assertTrue("a new scene starts empty", ed.scene().layers.isEmpty())
        assertEquals("…and does not go on the stream", start, ed.project.start)
        // looking at another scene does not put it on the stream either
        val soon = ed.project.scenes[1]
        tag(ed, "sc:scene:${soon.name}").performClick(); idle()
        assertEquals(soon.id, ed.editing)
        assertEquals(start, ed.project.start)
        // its menu does: «شروعِ پخش با این صحنه»
        tag(ed, "sc:scene:${soon.name}").performClick(); idle()   // (the open one: its menu)
        shadowOf(ShadowDialog.getLatestDialog() as AlertDialog).clickOnItem(4); idle()
        assertEquals(soon.id, ed.project.start)
        assertTrue("marked ▶", (tag(ed, "sc:scene:${soon.name}") as TextView).text.startsWith("▶"))
        later(400)
        val saved = Scenes.reload(app)
        assertEquals("saved", n + 1, saved.scenes.size)
        assertEquals(soon.id, saved.start)
    }

    @Test fun colourPickerGivesExactlyWhatWasTyped() {
        val ed = open()
        var got = 0
        ColorPicker.show(ed, "x", Color.WHITE) { got = it }
        idle()
        val d = ShadowDialog.getLatestDialog() as AlertDialog
        val hex = all(d.window!!.decorView).filterIsInstance<EditText>().first()
        hex.setText("#80112233")
        d.getButton(AlertDialog.BUTTON_POSITIVE).performClick(); idle()
        assertEquals(Color.argb(0x80, 0x11, 0x22, 0x33), got)
        // no transparency for a scene's background
        ColorPicker.show(ed, "bg", Color.BLACK, alpha = false) { got = it }
        idle()
        val d2 = ShadowDialog.getLatestDialog() as AlertDialog
        all(d2.window!!.decorView).filterIsInstance<EditText>().first().setText("#40FF0000")
        d2.getButton(AlertDialog.BUTTON_POSITIVE).performClick(); idle()
        assertEquals(Color.rgb(255, 0, 0), got)
    }

    @Test fun theEditorHasTheStreamsShape() {
        open()
        val a = Scenes.aspect(app)
        assertEquals("this phone sideways", 891f / 411f, a, 0.06f)
        val p = SceneEditorActivity.preview(app, 1000, null)
        assertEquals("the picture is as wide as the stream", 1000f / a, p.height.toFloat(), 1.5f)
    }

    /** 4.3 (the owner, a big tablet): the stage over the whole screen to place things exactly as on the stream. */
    @Test fun theStageGoesFullScreen() {
        val ed = open()
        assertFalse(ed.full)
        tag(ed, "sc:full").performClick(); idle()
        assertTrue("the stage over the whole screen", ed.full)
        assertTrue("a way back", tag(ed, "sc:full:exit").visibility == View.VISIBLE)
        tag(ed, "sc:full:exit").performClick(); idle()
        assertFalse(ed.full)
    }

    @Test fun onMyScreenTooIsTheOwnersChoice() {
        val ed = open()
        val l = add(ed, R.string.sc_k_text)
        assertTrue("texts are on my screen too unless I say no", Scenes.mine(l))
        assertEquals("viewers and me", 0, Scenes.audience(l))
        // 4.2: who sees it — viewers only, or only me (never on the stream)
        tag(ed, "sc:p:who:1").performClick(); idle()
        assertEquals("viewers only", 1, Scenes.audience(l))
        assertFalse(Scenes.mine(l))
        tag(ed, "sc:p:who:2").performClick(); idle()
        assertEquals("only me", 2, Scenes.audience(l))
        assertFalse("never the camera", Scenes.mine(Scenes.newLayer(app, Scenes.Kind.CAMERA)))
        assertTrue(Scenes.hasNumbers(Scenes.newLayer(app, Scenes.Kind.TEXT).apply { p.put("text", "{viewers} watching") }))
    }

    @Test fun theOwnerSeesEachLayerWhereTheStreamHasIt() {
        RuntimeEnvironment.setQualifiers("w891dp-h411dp-land-560dpi")
        val m = OwnerMirror(app)
        val red = Bitmap.createBitmap(100, 100, Bitmap.Config.ARGB_8888).apply { eraseColor(Color.RED) }
        m.set(listOf(OwnerMirror.Item(Scenes.Kind.TEXT, red, 0.25f, 0.5f, 0f, 1f, 0f, floatArrayOf(0f, 0f, 1f, 1f), 1f, 0f, true)))
        val real = android.graphics.Point()
        @Suppress("DEPRECATION") app.getSystemService(android.view.WindowManager::class.java)!!.defaultDisplay.getRealSize(real)
        val v = m.viewForTests
        v.measure(View.MeasureSpec.makeMeasureSpec(real.x, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(real.y, View.MeasureSpec.EXACTLY))
        v.layout(0, 0, real.x, real.y)
        val out = Bitmap.createBitmap(real.x, real.y, Bitmap.Config.ARGB_8888)
        v.draw(Canvas(out))
        val cx = (0.25f * real.x).toInt(); val cy = real.y / 2
        assertEquals("at its place", Color.RED, out.getPixel(cx, cy))
        assertEquals("nothing elsewhere", 0, Color.alpha(out.getPixel((0.75f * real.x).toInt(), cy)))
        // 100 pixels of a frame 1080 high: the same share of this screen's height, as wide as it is high
        val half = 50f * minOf(real.x, real.y) / 1080f
        assertEquals(Color.RED, out.getPixel((cx + half - 3).toInt(), cy))
        assertEquals(0, Color.alpha(out.getPixel((cx + half + 3).toInt(), cy)))
        assertEquals(Color.RED, out.getPixel(cx, (cy + half - 3).toInt()))
        assertEquals(0, Color.alpha(out.getPixel(cx, (cy + half + 3).toInt())))
        m.show(); idle()
        val lp = v.layoutParams as android.view.WindowManager.LayoutParams
        assertTrue("touches go to the game", lp.flags and android.view.WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE != 0)
        m.hide(); idle()
        assertFalse(v.isAttachedToWindow)
    }

    @Test fun aRoundCameraIsACircle() {
        val l = Scenes.newLayer(app, Scenes.Kind.CAMERA).apply { p.put("mask", 2) }
        for ((w, h) in listOf(1280f to 960f, 720f to 1280f)) {
            val c = Scenes.cropFor(l, w, h)
            assertEquals("square for $w×$h", 1f, w * (c[2] - c[0]) / (h * (c[3] - c[1])), 0.001f)
            assertEquals("centred", 0.5f, (c[0] + c[2]) / 2f, 0.001f)
        }
        l.p.put("mask", 1)
        assertTrue(Scenes.cropFor(l, 1280f, 960f).contentEquals(l.crop))
    }

    @Test fun alertTextsAreTheOwnersOwn() {
        val l = Scenes.newLayer(app, Scenes.Kind.ALERTS)
        l.p.put("t_sub", "خوش اومدی {name}!")
        val b = LayerPainter.alertPic(app, l, LayerPainter.Alert(LayerPainter.AlertKind.SUBSCRIBER, "Sara_99"))
        assertTrue(b.width > 0 && b.height > 0)
        // every kind has a text with the sender's name in it
        for (k in listOf("t_sub", "t_member", "t_super", "t_gift", "t_cheer", "t_raid", "t_give", "t_goal"))
            assertTrue("$k", Scenes.newLayer(app, Scenes.Kind.ALERTS).str(k).contains("{name}"))
    }
}
