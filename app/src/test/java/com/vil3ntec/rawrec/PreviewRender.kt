package com.vil3ntec.rawrec

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.os.Looper
import android.view.View
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import java.time.Duration

/**
 * Draws the real views to PNG (only when -Drawrec.previewDir=… is given): home idle, home recording
 * and the floating control, on a phone and a tablet.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class PreviewRender {
    private val dir: String? = System.getProperty("rawrec.previewDir")

    private fun save(v: View, name: String, w: Int = v.width, h: Int = v.height, under: ((Canvas) -> Unit)? = null) {
        val b = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        under?.invoke(c)
        v.draw(c)
        File(dir, "$name.png").outputStream().use { b.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun setState(s: RecordService.State, startedAgoMs: Long) {
        val k = RecordService::class.java
        k.getDeclaredField("state").apply { isAccessible = true }.set(null, s)
        k.getDeclaredField("startedAt").apply { isAccessible = true }.setLong(null, if (startedAgoMs > 0) System.currentTimeMillis() - startedAgoMs else 0L)
        k.getDeclaredField("applied").apply { isAccessible = true }.set(null, "HEVC • 1504×2400 • 120 fps • 25 Mbps VBR")
    }

    private fun encoders() {
        org.robolectric.shadows.ShadowMediaCodecList.reset()
        Encoders.clearCache()
        val pl = android.media.MediaCodecInfo.CodecProfileLevel().apply {
            profile = android.media.MediaCodecInfo.CodecProfileLevel.HEVCProfileMain
            level = android.media.MediaCodecInfo.CodecProfileLevel.HEVCMainTierLevel62
        }
        val caps = org.robolectric.shadows.MediaCodecInfoBuilder.CodecCapabilitiesBuilder.newBuilder()
            .setMediaFormat(android.media.MediaFormat.createVideoFormat(android.media.MediaFormat.MIMETYPE_VIDEO_HEVC, 8192, 4320)).setIsEncoder(true)
            .setProfileLevels(arrayOf(pl)).setColorFormats(intArrayOf(android.media.MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)).build()
        org.robolectric.shadows.ShadowMediaCodecList.addCodec(org.robolectric.shadows.MediaCodecInfoBuilder.newBuilder()
            .setName("c2.qti.hevc.encoder").setIsEncoder(true).setIsHardwareAccelerated(true).setIsVendor(true).setCapabilities(caps).build())
        org.robolectric.shadows.ShadowDisplayManager.setSupportedModes(android.view.Display.DEFAULT_DISPLAY,
            android.view.Display.Mode(0, 1504, 2400, 120f), android.view.Display.Mode(2, 1504, 2400, 60f))
    }

    private fun render(qualifiers: String, tag: String) {
        RuntimeEnvironment.setQualifiers(qualifiers)
        encoders()
        setState(RecordService.State.IDLE, 0)
        val c = Robolectric.buildActivity(MainActivity::class.java).setup()
        shadowOf(Looper.getMainLooper()).idle()
        val root = c.get().window.decorView
        save(root, "home-idle-$tag")
        setState(RecordService.State.RECORDING, 154_000)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(900))
        save(root, "home-recording-$tag")
        setState(RecordService.State.IDLE, 0)
        c.pause().stop().destroy()

        val app = RuntimeEnvironment.getApplication()
        val f = FloatingControl(app, false, object : FloatingControl.Actions {
            override fun stop() {}; override fun pauseToggle() {}; override fun micToggle() {}; override fun camToggle() {}; override fun delete() {}
        })
        f.show(); f.setRecording(true); f.setTime(2); f.setMic(true, true); f.setCam(false, true)
        shadowOf(Looper.getMainLooper()).idle()
        val pad = (24 * app.resources.displayMetrics.density).toInt()
        val w = f.root.width + pad * 6; val h = f.root.height + pad * 2
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val cv = Canvas(bmp)
        cv.drawPaint(Paint().apply { shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), Color.rgb(40, 52, 80), Color.rgb(90, 40, 60), Shader.TileMode.CLAMP) })
        cv.translate((w - f.root.width - pad).toFloat(), pad.toFloat())
        f.root.draw(cv)
        File(dir, "pill-$tag.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        f.hide()
    }

    @Test fun phone() { assumeTrue(dir != null); render("w411dp-h914dp-xxhdpi", "phone") }
    @Test fun tablet() { assumeTrue(dir != null); render("sw800dp-w1280dp-h800dp-land-mdpi", "tablet") }
}
