package com.vil3ntec.rawrec

import android.graphics.SurfaceTexture
import android.opengl.EGL14
import android.opengl.EGLConfig
import android.opengl.EGLContext
import android.opengl.EGLDisplay
import android.opengl.EGLExt
import android.opengl.EGLSurface
import android.opengl.GLES11Ext
import android.opengl.GLES20
import android.os.Handler
import android.os.HandlerThread
import android.view.Surface
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * «ظاهرِ ویدیو»: the edit is done while recording, so the file comes out already edited.
 *
 * The screen goes into a texture instead of straight into the encoder; one small shader draws it
 * into the encoder's surface with fine sharpening and «جزئیاتِ دور» (local clarity at ~3 px), both
 * on brightness only and cored against noise, then contrast, brightness, colour (saturation +
 * vibrance), warmth and a half-step dither against banding. One full-screen pass of at most nine
 * texture reads: for a phone GPU at 2400×1504 × 60 fps a fraction of a millisecond per frame, far
 * below what a game uses, and only when a look other than «طبیعی» is chosen (otherwise the screen
 * still goes straight into the encoder, as before).
 *
 * Why it helps so much on gaming phones: their display chip sharpens and enriches the picture on
 * its way to the panel; a screen capture gets the picture before that, so it looks flatter than
 * the eye saw. The look gives that back in the file.
 *
 * Frames keep the compositor's timestamps (eglPresentationTimeANDROID), so pause, rotation and
 * ghost-mode cuts in Recorder work unchanged. Frames that come faster than [fps] are taken from the
 * screen but not drawn (a 165 Hz screen into a 60 fps video).
 */
class LookFilter(private val look: Look, private val fps: Int) {

    /** Strengths; neutral = 0 / 1. [sharp] 0…1.2, [contrast] 0.9…1.25, [saturation] 0.8…1.4. */
    data class Look(
        val sharp: Float = 0f,
        val contrast: Float = 1f,
        val brightness: Float = 0f,
        val saturation: Float = 1f,
        val vibrance: Float = 0f,
        val warmth: Float = 0f,
        val clarity: Float = 0f,
    ) {
        val neutral get() = sharp == 0f && clarity == 0f && contrast == 1f && brightness == 0f && saturation == 1f && vibrance == 0f && warmth == 0f
        /** Dither only when tones are stretched (contrast, brightness, colour): otherwise nothing to smooth. */
        val dither get() = if (contrast != 1f || brightness != 0f || saturation != 1f || vibrance != 0f) 1f else 0f
    }

    private val thread = HandlerThread("rawrec-look").apply { start() }
    private val h = Handler(thread.looper)

    private var dpy: EGLDisplay = EGL14.EGL_NO_DISPLAY
    private var ctx: EGLContext = EGL14.EGL_NO_CONTEXT
    private var cfg: EGLConfig? = null
    private var pbuffer: EGLSurface = EGL14.EGL_NO_SURFACE
    private var out: EGLSurface = EGL14.EGL_NO_SURFACE
    private var outW = 0
    private var outH = 0
    private var tex = 0
    private var prog = 0
    private lateinit var st: SurfaceTexture
    private val stMatrix = FloatArray(16)
    private var lastNs = 0L
    @Volatile var drawn = 0L; private set

    // ---- «برمی‌گردم» (live): a still picture drawn instead of the screen, ~30 times a second so the
    // stream never stops flowing while the game is away or the owner wants privacy.
    @Volatile private var coverOn = false
    private var coverTex = 0
    private var coverProg = 0
    private val coverTick = object : Runnable {
        override fun run() {
            if (!coverOn) return
            drawCover()
            h.postDelayed(this, 33)
        }
    }

    // ---- live overlays: small pictures drawn over the screen (alerts, subscriber count, goal bar),
    // each uploaded once and then only moved / faded. [x],[y],[w],[h] are fractions of the frame
    // from its top-left corner. Bitmaps handed over here are never drawn into again by the caller.
    /**
     * One picture over the stream: [bitmap] (uploaded once per [gen]) or, when [ext] > 0, a live
     * source (video, camera) from [createExternal]. ([x], [y], [w], [h]) is the unturned rectangle
     * in frame fractions, turned by [rot] degrees about its centre; [crop] keeps a part of the
     * source (left, top, right, bottom fractions); [corner] rounds it (pixels of a frame 1080 high, ≥ half the
     * short side = a circle); [mirror] flips it left-right.
     */
    class Layer(
        val id: Int, val bitmap: android.graphics.Bitmap?, val gen: Int, val x: Float, val y: Float, val w: Float, val h: Float, val alpha: Float,
        val rot: Float = 0f, val crop: FloatArray? = null, val ext: Int = 0, val corner: Float = 0f, val mirror: Boolean = false,
    )

    @Volatile private var layers: List<Layer> = emptyList()
    private val layerTex = HashMap<Int, IntArray>()   // id → [texture, gen]
    private var layerProg = 0
    private var lastPts = 0L
    private var lastDrawNs = 0L

    /** Fewer pictures a second for a while (a hot phone); 0 = the full rate. */
    @Volatile var fpsCap = 0

    /** Pictures the screen has sent so far (whether drawn or not): 0 = nothing captured at all. */
    @Volatile var screenFrames = 0L; private set
    /** The last error while drawing (kept for the report instead of being lost). */
    @Volatile var drawError: String? = null; private set
    @Volatile private var flowing = false

    /**
     * Live: the stream never waits for the screen. A picture goes to the encoder at once (black
     * until the screen sends one) and then at least ~10 times a second — the last screen picture
     * with the layers over it — so the platform gets a stream even when the screen sends nothing
     * (a still screen, or «one app» shared and that app not on the screen).
     */
    fun startFlowing() {
        flowing = true
        h.post(flowTick)
    }

    private val flowTick = object : Runnable {
        override fun run() {
            if (!flowing || dpy == EGL14.EGL_NO_DISPLAY) return
            if (!coverOn && out != EGL14.EGL_NO_SURFACE && System.nanoTime() - lastDrawNs > 100_000_000L) {
                try { redraw() } catch (t: Throwable) { drawError = "flow: " + (t.message ?: t.javaClass.simpleName) }
            }
            h.postDelayed(this, 100)
        }
    }

    // ---- live: black bars around the game cut away. A tablet held upright shows a landscape game as
    // a band in the middle of an upright screen; that screen put whole into the landscape stream left
    // the game at 39 % of the picture (4.0, the owner's screenshots). The part of the screen holding
    // the picture is found (twice a second, on a 160×100 copy) and drawn over the whole frame.
    /** The part of the screen drawn: x, y (from the bottom), width, height in screen fractions. */
    private val region = floatArrayOf(0f, 0f, 1f, 1f)
    @Volatile var cropped = false; private set
    /** The part of the screen on the stream now (for the owner's own view, see OwnerMirror.Geo). */
    @Volatile var regionNow: FloatArray = floatArrayOf(0f, 0f, 1f, 1f); private set
    private var lastBarsNs = 0L
    private var barsProg = 0
    private var barsFbo = 0
    private var barsTex = 0
    private val barsPx = ByteBuffer.allocateDirect(BARS_W * BARS_H * 4).order(ByteOrder.nativeOrder())
    private var seen: FloatArray? = null
    private var seenTimes = 0

    private fun findBars() {
        if (barsProg == 0) barsProg = program(VS, FS_PLAIN)
        if (barsFbo == 0) {
            val t = IntArray(1)
            GLES20.glGenTextures(1, t, 0); barsTex = t[0]
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, barsTex)
            GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, BARS_W, BARS_H, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glGenFramebuffers(1, t, 0); barsFbo = t[0]
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, barsFbo)
            GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, barsTex, 0)
        }
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, barsFbo)
        GLES20.glViewport(0, 0, BARS_W, BARS_H)
        GLES20.glDisable(GLES20.GL_BLEND)
        GLES20.glUseProgram(barsProg)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(barsProg, "tex"), 0)
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(barsProg, "stm"), 1, false, stMatrix, 0)
        GLES20.glUniform4f(GLES20.glGetUniformLocation(barsProg, "region"), 0f, 0f, 1f, 1f)
        val pos = GLES20.glGetAttribLocation(barsProg, "pos")
        GLES20.glEnableVertexAttribArray(pos)
        GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, QUAD)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(pos)
        barsPx.clear()
        GLES20.glReadPixels(0, 0, BARS_W, BARS_H, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, barsPx)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        GLES20.glViewport(0, 0, outW, outH)
        val px = ByteArray(BARS_W * BARS_H * 4)
        barsPx.position(0); barsPx.get(px)
        val want = barsRegion(px, BARS_W, BARS_H) ?: return
        // the same answer twice in a row (a second) before the picture changes: no jumping on a dark scene
        val prev = seen
        if (prev != null && near(prev, want, 0.02f)) seenTimes++ else { seen = want; seenTimes = 1 }
        if (seenTimes >= 2 && !near(want, region, 0.05f)) {
            want.copyInto(region)
            cropped = region[2] < 0.999f
            regionNow = region.copyOf()
        }
    }

    private fun near(a: FloatArray, b: FloatArray, d: Float) = (0..3).all { kotlin.math.abs(a[it] - b[it]) <= d }

    // ---- the game off the screen («one app» shared, another app in front): Android then sends black,
    // so the last good picture is kept on the GPU and drawn instead until the game is back.
    @Volatile private var holding = false
    private var heldFbo = 0
    private var heldTex = 0
    private var heldProg = 0

    /** [on]: keep showing the game's last picture (with the layers over it); off: the screen again. */
    fun hold(on: Boolean) {
        h.post {
            if (dpy == EGL14.EGL_NO_DISPLAY) return@post
            if (!on) { holding = false; return@post }
            if (holding || out == EGL14.EGL_NO_SURFACE || drawn == 0L) return@post
            try {
                EGL14.eglMakeCurrent(dpy, out, out, ctx)
                if (heldFbo == 0) {
                    val t = IntArray(1)
                    GLES20.glGenTextures(1, t, 0); heldTex = t[0]
                    GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, heldTex)
                    GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, outW, outH, 0, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null)
                    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
                    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
                    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
                    GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
                    GLES20.glGenFramebuffers(1, t, 0); heldFbo = t[0]
                    GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, heldFbo)
                    GLES20.glFramebufferTexture2D(GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0, GLES20.GL_TEXTURE_2D, heldTex, 0)
                }
                GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, heldFbo)
                GLES20.glDisable(GLES20.GL_BLEND)
                draw()   // the last screen picture (black bars cut), without the layers
                GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
                holding = true
            } catch (t: Throwable) {
                try { GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0) } catch (_: Throwable) {}
                drawError = "hold: " + (t.message ?: t.javaClass.simpleName)
            }
        }
    }

    /** The kept picture into the viewport ([vx], [vy], [vw], [vh]). */
    private fun drawHeld(vx: Int = 0, vy: Int = 0, vw: Int = outW, vh: Int = outH) {
        if (heldProg == 0) heldProg = program(VS_HELD, FS_COVER)
        GLES20.glViewport(vx, vy, vw, vh)
        GLES20.glDisable(GLES20.GL_BLEND)
        GLES20.glUseProgram(heldProg)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, heldTex)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(heldProg, "tex"), 0)
        val pos = GLES20.glGetAttribLocation(heldProg, "pos")
        GLES20.glEnableVertexAttribArray(pos)
        GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, QUAD)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(pos)
    }

    /** The last screen picture again (black before the first), the layers over it. GL thread. */
    private fun redraw() {
        EGL14.eglMakeCurrent(dpy, out, out, ctx)
        if (holding) drawHeld() else if (drawn > 0) draw() else {
            GLES20.glViewport(0, 0, outW, outH)
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
        }
        latchExternals()
        drawLayers()
        present(System.nanoTime())
    }

    /** Replaces what is drawn over the screen (empty = nothing). Cheap when only positions or alpha change. */
    fun setLayers(list: List<Layer>) {
        layers = list
        h.post {
            if (dpy == EGL14.EGL_NO_DISPLAY) return@post
            try {
                EGL14.eglMakeCurrent(dpy, pbuffer, pbuffer, ctx)
                uploadLayers(list)
                refresh()
            } catch (_: Throwable) {}
        }
    }

    private fun uploadLayers(list: List<Layer>) {
        val ids = list.map { it.id }.toHashSet()
        for (id in layerTex.keys.filter { it !in ids }) {
            GLES20.glDeleteTextures(1, intArrayOf(layerTex.remove(id)!![0]), 0)
        }
        for (l in list) {
            val bmp = l.bitmap ?: continue
            val t = layerTex.getOrPut(l.id) {
                val a = IntArray(1)
                GLES20.glGenTextures(1, a, 0)
                intArrayOf(a[0], -1)
            }
            if (t[1] == l.gen || bmp.isRecycled) continue
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t[0])
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            android.opengl.GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, bmp, 0)
            t[1] = l.gen
        }
    }

    /** The layers over what was just drawn; Android bitmaps are premultiplied, so ONE / 1−α. */
    /** A layer program that would not build on this GPU: the layers are left out, the picture goes on. */
    private var layersBroken = false

    private fun drawLayers() {
        if (layersBroken || layers.isEmpty()) return
        try { drawLayersNow() } catch (t: Throwable) {
            layersBroken = true
            try { GLES20.glDisable(GLES20.GL_BLEND) } catch (_: Throwable) {}
            android.util.Log.w("LookFilter", "layers off: " + t.message)
        }
    }

    private fun drawLayersNow() {
        val list = layers
        if (layerProg == 0) layerProg = program(VS_LAYER, FS_LAYER)
        if (extProg == 0 && list.any { it.ext > 0 }) extProg = program(VS_LAYER, FS_LAYER_EXT)
        GLES20.glViewport(0, 0, outW, outH)
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        for (l in list) {
            if (l.alpha <= 0f) continue
            val prog: Int
            if (l.ext > 0) {
                val e = externals[l.ext] ?: continue
                if (!e.ready || extProg == 0) continue
                prog = extProg
                GLES20.glUseProgram(prog)
                GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, e.tex)
                GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(prog, "stm"), 1, false, e.matrix, 0)
            } else {
                val t = layerTex[l.id] ?: continue
                if (t[1] != l.gen) continue
                prog = layerProg
                GLES20.glUseProgram(prog)
                GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t[0])
            }
            GLES20.glUniform1i(GLES20.glGetUniformLocation(prog, "tex"), 0)
            val pw = l.w * outW; val ph = l.h * outH
            GLES20.glUniform2f(GLES20.glGetUniformLocation(prog, "center"), l.x * outW + pw / 2f, l.y * outH + ph / 2f)
            GLES20.glUniform2f(GLES20.glGetUniformLocation(prog, "size"), pw, ph)
            GLES20.glUniform2f(GLES20.glGetUniformLocation(prog, "box"), pw, ph)   // the same, for the fragment shader (own precision)
            GLES20.glUniform2f(GLES20.glGetUniformLocation(prog, "outSize"), outW.toFloat(), outH.toFloat())
            GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "angle"), Math.toRadians(l.rot.toDouble()).toFloat())
            val c = l.crop ?: FULL
            GLES20.glUniform4f(GLES20.glGetUniformLocation(prog, "crop"), c[0], c[1], c[2], c[3])
            GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "mirror"), if (l.mirror) 1f else 0f)
            // corner radius given in pixels of a frame 1080 high (short side): scaled to this output
            GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "corner"), (l.corner * minOf(outW, outH) / 1080f).coerceAtMost(minOf(pw, ph) / 2f))
            GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "alpha"), l.alpha.coerceIn(0f, 1f))
            val pos = GLES20.glGetAttribLocation(prog, "pos")
            GLES20.glEnableVertexAttribArray(pos)
            GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, QUAD)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GLES20.glDisableVertexAttribArray(pos)
        }
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    // ---- live sources over the stream (video files, the camera): a texture each, fed by a Surface
    private class External(val tex: Int, val st: SurfaceTexture, val surface: Surface) {
        val matrix = FloatArray(16).also { android.opengl.Matrix.setIdentityM(it, 0) }
        val raw = FloatArray(16)
        /** Degrees the picture is turned (the camera's sensor against the screen). */
        @Volatile var turn = 0f
        @Volatile var fresh = false
        var ready = false
    }

    /** Turns a live source's picture by [deg] (about its centre), e.g. the camera upright. */
    fun setExternalRotation(id: Int, deg: Float) { h.post { externals[id]?.turn = deg } }
    private val externals = HashMap<Int, External>()
    private var extProg = 0
    private var nextExt = 1

    /**
     * A new live source: returns its id (for [Layer.ext]) and the Surface a video player or the
     * camera draws into ([w]×[h] its buffer size, when the producer does not set one). 0 / null when
     * the GPU stage is not running.
     */
    fun createExternal(w: Int, h: Int): Pair<Int, Surface>? {
        var out: Pair<Int, Surface>? = null
        runSync {
            if (dpy == EGL14.EGL_NO_DISPLAY) return@runSync
            EGL14.eglMakeCurrent(dpy, pbuffer, pbuffer, ctx)
            val t = IntArray(1)
            GLES20.glGenTextures(1, t, 0)
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, t[0])
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            val st = SurfaceTexture(t[0])
            if (w > 0 && h > 0) st.setDefaultBufferSize(w, h)
            val id = nextExt++
            val e = External(t[0], st, Surface(st))
            st.setOnFrameAvailableListener({ e.fresh = true; refresh() }, this.h)
            externals[id] = e
            out = id to e.surface
        }
        return out
    }

    fun releaseExternal(id: Int) {
        h.post {
            val e = externals.remove(id) ?: return@post
            try { e.surface.release() } catch (_: Throwable) {}
            try { e.st.release() } catch (_: Throwable) {}
            try {
                if (dpy != EGL14.EGL_NO_DISPLAY) { EGL14.eglMakeCurrent(dpy, pbuffer, pbuffer, ctx); GLES20.glDeleteTextures(1, intArrayOf(e.tex), 0) }
            } catch (_: Throwable) {}
        }
    }

    /** New frames of the live sources into their textures (GL thread, before the layers are drawn). */
    private fun latchExternals() {
        for (e in externals.values) if (e.fresh) {
            e.fresh = false
            try {
                e.st.updateTexImage()
                e.st.getTransformMatrix(e.raw)
                if (e.turn == 0f) System.arraycopy(e.raw, 0, e.matrix, 0, 16)
                else {
                    val r = FloatArray(16)
                    android.opengl.Matrix.setIdentityM(r, 0)
                    android.opengl.Matrix.translateM(r, 0, 0.5f, 0.5f, 0f)
                    android.opengl.Matrix.rotateM(r, 0, e.turn, 0f, 0f, 1f)
                    android.opengl.Matrix.translateM(r, 0, -0.5f, -0.5f, 0f)
                    android.opengl.Matrix.multiplyMM(e.matrix, 0, e.raw, 0, r, 0)
                }
                e.ready = true
            } catch (_: Throwable) {}
        }
    }

    /** Frame times only ever go forward (the screen's and the cover's / refresh's clocks meet here). */
    private fun present(ts: Long) {
        val t = if (ts <= lastPts) lastPts + 1_000 else ts
        lastPts = t
        lastDrawNs = System.nanoTime()
        EGLExt.eglPresentationTimeANDROID(dpy, out, t)
        EGL14.eglSwapBuffers(dpy, out)
        drawShorts(t)
    }

    // ---- 7.0: the recording beside the stream — the screen itself, clean (no stream layers, no
    // «be right back»), at the recording's own size and frame rate, into its own encoder.
    private var out3: EGLSurface = EGL14.EGL_NO_SURFACE
    private var w3 = 0
    private var h3 = 0
    @Volatile private var fps3 = 0
    private var lastRecNs = 0L
    @Volatile var recError: String? = null; private set

    /** 7.3: the screen's own size when it is bigger than the stream's picture (a recording beside the stream); 0 = the output's size. */
    private var inW = 0
    private var inH = 0
    fun setInputSize(w: Int, h0: Int) = runSync {
        inW = w.coerceAtLeast(0); inH = h0.coerceAtLeast(0)
        st.setDefaultBufferSize(if (inW > 0) inW else outW, if (inH > 0) inH else outH)
    }

    /** The recording encoder's input (null = none), its size and frame rate. */
    fun setRecordOutput(s: Surface?, w: Int, h0: Int, fpsWanted: Int) = runSync {
        if (out3 != EGL14.EGL_NO_SURFACE) {
            EGL14.eglMakeCurrent(dpy, pbuffer, pbuffer, ctx)
            EGL14.eglDestroySurface(dpy, out3)
            out3 = EGL14.EGL_NO_SURFACE
        }
        lastRecNs = 0L
        if (s != null && s.isValid) {
            out3 = EGL14.eglCreateWindowSurface(dpy, cfg, s, intArrayOf(EGL14.EGL_NONE), 0)
            w3 = w; h3 = h0; fps3 = fpsWanted
        }
    }

    private fun drawRec(t: Long) {
        try {
            EGL14.eglMakeCurrent(dpy, out3, out3, ctx)
            GLES20.glViewport(0, 0, w3, h3)
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            if (holding) drawHeld(0, 0, w3, h3) else draw(0, 0, w3, h3, w3, h3)
            EGLExt.eglPresentationTimeANDROID(dpy, out3, t)
            EGL14.eglSwapBuffers(dpy, out3)
        } catch (e: Throwable) { recError = "draw: " + (e.message ?: e.javaClass.simpleName) }
        finally { try { EGL14.eglMakeCurrent(dpy, out, out, ctx) } catch (_: Throwable) {} }
    }

    // ---- Shorts (YouTube «Dual stream»): the same picture in a tall 9:16 frame for a second encoder,
    // drawn right after each frame of the stream with the same time. The game in its rectangle (the
    // black bars cut as above), the title or picture above it and the chat below.
    private var out2: EGLSurface = EGL14.EGL_NO_SURFACE
    private var w2 = 0
    private var h2 = 0
    private var shortsGame = android.graphics.Rect()
    private var shortsTop: android.graphics.Rect? = null
    private var shortsBottom: android.graphics.Rect? = null
    private var shortsTopTex = 0
    private var shortsBottomTex = 0
    @Volatile var shortsError: String? = null; private set

    /** The second encoder's input (null = no tall picture). */
    fun setShortsOutput(s: Surface?, w: Int, h0: Int) = runSync {
        if (out2 != EGL14.EGL_NO_SURFACE) {
            EGL14.eglMakeCurrent(dpy, pbuffer, pbuffer, ctx)
            EGL14.eglDestroySurface(dpy, out2)
            out2 = EGL14.EGL_NO_SURFACE
        }
        if (s != null && s.isValid) {
            out2 = EGL14.eglCreateWindowSurface(dpy, cfg, s, intArrayOf(EGL14.EGL_NONE), 0)
            w2 = w; h2 = h0
        }
    }

    /** Where the game is in the tall picture, and what is above it ([topPic]) — set once, or when changed. */
    fun setShortsLayout(game: android.graphics.Rect, top: android.graphics.Rect?, topPic: android.graphics.Bitmap?, bottom: android.graphics.Rect?) {
        h.post {
            if (dpy == EGL14.EGL_NO_DISPLAY) return@post
            try {
                EGL14.eglMakeCurrent(dpy, pbuffer, pbuffer, ctx)
                shortsGame = game; shortsTop = top; shortsBottom = bottom
                shortsTopTex = upload2d(shortsTopTex, topPic)
            } catch (t: Throwable) { shortsError = "layout: " + (t.message ?: t.javaClass.simpleName) }
        }
    }

    /** The chat below the game (a picture of that part's size; null = none). */
    fun setShortsChat(b: android.graphics.Bitmap?) {
        h.post {
            if (dpy == EGL14.EGL_NO_DISPLAY) return@post
            try {
                EGL14.eglMakeCurrent(dpy, pbuffer, pbuffer, ctx)
                shortsBottomTex = upload2d(shortsBottomTex, b)
            } catch (t: Throwable) { shortsError = "chat: " + (t.message ?: t.javaClass.simpleName) }
        }
    }

    private fun upload2d(old: Int, b: android.graphics.Bitmap?): Int {
        if (b == null || b.isRecycled) { if (old != 0) GLES20.glDeleteTextures(1, intArrayOf(old), 0); return 0 }
        val t = if (old != 0) old else IntArray(1).also { GLES20.glGenTextures(1, it, 0) }[0]
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
        android.opengl.GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, b, 0)
        return t
    }

    /** A 2D picture over the rectangle [r] of the tall frame (y from the top). */
    private fun drawPic2(tex2: Int, r: android.graphics.Rect, blend: Boolean) {
        if (tex2 == 0 || r.width() <= 0 || r.height() <= 0) return
        if (coverProg == 0) coverProg = program(VS_COVER, FS_COVER)
        GLES20.glViewport(r.left, h2 - r.bottom, r.width(), r.height())
        if (blend) { GLES20.glEnable(GLES20.GL_BLEND); GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA) } else GLES20.glDisable(GLES20.GL_BLEND)
        GLES20.glUseProgram(coverProg)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex2)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(coverProg, "tex"), 0)
        val pos = GLES20.glGetAttribLocation(coverProg, "pos")
        GLES20.glEnableVertexAttribArray(pos)
        GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, QUAD)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(pos)
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    private fun drawShorts(t: Long) {
        if (out2 == EGL14.EGL_NO_SURFACE) return
        try {
            EGL14.eglMakeCurrent(dpy, out2, out2, ctx)
            GLES20.glViewport(0, 0, w2, h2)
            GLES20.glClearColor(0f, 0f, 0f, 1f)
            GLES20.glClear(GLES20.GL_COLOR_BUFFER_BIT)
            val g = shortsGame
            if (coverOn) drawPic2(coverTex, g, false)
            else if (holding) drawHeld(g.left, h2 - g.bottom, g.width(), g.height())
            else if (drawn > 0) draw(g.left, h2 - g.bottom, g.width(), g.height())
            shortsTop?.let { drawPic2(shortsTopTex, it, true) }
            shortsBottom?.let { drawPic2(shortsBottomTex, it, true) }
            EGLExt.eglPresentationTimeANDROID(dpy, out2, t)
            EGL14.eglSwapBuffers(dpy, out2)
        } catch (e: Throwable) { shortsError = "draw: " + (e.message ?: e.javaClass.simpleName) }
        finally { try { EGL14.eglMakeCurrent(dpy, out, out, ctx) } catch (_: Throwable) {} }
    }

    /**
     * A still screen sends no new frames, so a changed overlay would wait for the next one: the last
     * screen picture is drawn again with the overlay (only when nothing came for a while).
     */
    private fun refresh() {
        if (out == EGL14.EGL_NO_SURFACE || coverOn || (drawn == 0L && !flowing)) return
        if (System.nanoTime() - lastDrawNs < 120_000_000L) return
        try { redraw() } catch (t: Throwable) { drawError = "refresh: " + (t.message ?: t.javaClass.simpleName) }
    }

    // ---- privacy check of the chat on the phone: the colour of one point of the captured screen
    @Volatile private var probeAt: FloatArray? = null
    /** Last colour read at the probe point (0xRRGGBB), and how many screen frames were read. */
    @Volatile var probeRgb = 0; private set
    @Volatile var probeFrames = 0; private set
    private val px = ByteBuffer.allocateDirect(4).order(ByteOrder.nativeOrder())

    /** Reads the screen's colour at ([fx],[fy]) (fractions of the frame) on every frame; null stops. */
    fun probe(fx: Float?, fy: Float?) {
        probeAt = if (fx == null || fy == null) null else floatArrayOf(fx, fy)
        probeFrames = 0
    }

    private fun readProbe() {
        val p = probeAt ?: return
        val x = (p[0] * outW).toInt().coerceIn(0, outW - 1)
        val y = (outH - 1 - (p[1] * outH).toInt()).coerceIn(0, outH - 1)
        px.clear()
        GLES20.glReadPixels(x, y, 1, 1, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, px)
        val r = px.get(0).toInt() and 255
        val g = px.get(1).toInt() and 255
        val b = px.get(2).toInt() and 255
        probeRgb = (r shl 16) or (g shl 8) or b
        probeFrames++
    }

    /** Shows [b] instead of the screen; null = the screen again. */
    fun setCover(b: android.graphics.Bitmap?) {
        h.post {
            if (dpy == EGL14.EGL_NO_DISPLAY) return@post
            try {
                EGL14.eglMakeCurrent(dpy, pbuffer, pbuffer, ctx)
                if (b == null) {
                    coverOn = false
                    h.removeCallbacks(coverTick)
                    if (coverTex != 0) { GLES20.glDeleteTextures(1, intArrayOf(coverTex), 0); coverTex = 0 }
                    return@post
                }
                if (coverProg == 0) coverProg = program(VS_COVER, FS_COVER)
                if (coverTex == 0) {
                    val t = IntArray(1)
                    GLES20.glGenTextures(1, t, 0)
                    coverTex = t[0]
                }
                GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, coverTex)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
                GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
                android.opengl.GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, b, 0)
                coverOn = true
                h.removeCallbacks(coverTick)
                h.post(coverTick)
            } catch (_: Throwable) {}
        }
    }

    private fun drawCover() {
        if (out == EGL14.EGL_NO_SURFACE || coverTex == 0) return
        try {
            EGL14.eglMakeCurrent(dpy, out, out, ctx)
            GLES20.glViewport(0, 0, outW, outH)
            GLES20.glUseProgram(coverProg)
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, coverTex)
            GLES20.glUniform1i(GLES20.glGetUniformLocation(coverProg, "tex"), 0)
            val pos = GLES20.glGetAttribLocation(coverProg, "pos")
            GLES20.glEnableVertexAttribArray(pos)
            GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, QUAD)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GLES20.glDisableVertexAttribArray(pos)
            latchExternals()
            drawLayers()
            present(System.nanoTime())
        } catch (_: Throwable) {}
    }

    /** What the virtual display draws into. */
    lateinit var input: Surface
        private set

    /** Sets up EGL and the shader; throws when the GPU path can't be used (the caller records directly). */
    fun start(w: Int, h0: Int) {
        var err: Throwable? = null
        runSync {
            try { setup(w, h0) } catch (t: Throwable) { err = t }
        }
        err?.let { release(); throw it }
    }

    /**
     * Where to draw: the encoder's input surface of size [w]×[h], or null to stop drawing (before the
     * encoder is released). Also sets the size the screen is drawn in, so call it before the virtual
     * display is resized.
     */
    fun setOutput(s: Surface?, w: Int, h0: Int) = runSync {
        if (out != EGL14.EGL_NO_SURFACE) {
            EGL14.eglMakeCurrent(dpy, pbuffer, pbuffer, ctx)
            EGL14.eglDestroySurface(dpy, out)
            out = EGL14.EGL_NO_SURFACE
        }
        st.setDefaultBufferSize(if (inW > 0) inW else w, if (inH > 0) inH else h0)
        outW = w; outH = h0
        if (s != null && s.isValid) {
            out = EGL14.eglCreateWindowSurface(dpy, cfg, s, intArrayOf(EGL14.EGL_NONE), 0)
            if (out == EGL14.EGL_NO_SURFACE) throw IllegalStateException("eglCreateWindowSurface 0x" + Integer.toHexString(EGL14.eglGetError()))
        }
    }

    fun release() {
        flowing = false
        runSync {
            h.removeCallbacks(flowTick)
            try { if (::st.isInitialized) st.release() } catch (_: Throwable) {}
            try { if (::input.isInitialized) input.release() } catch (_: Throwable) {}
            if (dpy != EGL14.EGL_NO_DISPLAY) {
                EGL14.eglMakeCurrent(dpy, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                if (out != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(dpy, out)
                if (out2 != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(dpy, out2)
                if (out3 != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(dpy, out3)
                if (pbuffer != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(dpy, pbuffer)
                if (ctx != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(dpy, ctx)
                EGL14.eglTerminate(dpy)
            }
            out = EGL14.EGL_NO_SURFACE; out2 = EGL14.EGL_NO_SURFACE; pbuffer = EGL14.EGL_NO_SURFACE; ctx = EGL14.EGL_NO_CONTEXT; dpy = EGL14.EGL_NO_DISPLAY
        }
        thread.quitSafely()
    }

    // ------------------------------------------------------------ GL thread

    private fun runSync(block: () -> Unit) {
        if (Thread.currentThread() === thread) { block(); return }
        val done = CountDownLatch(1)
        var err: Throwable? = null
        if (!h.post { try { block() } catch (t: Throwable) { err = t } finally { done.countDown() } }) return
        done.await(3, TimeUnit.SECONDS)
        err?.let { throw it }
    }

    private fun setup(w: Int, h0: Int) {
        dpy = EGL14.eglGetDisplay(EGL14.EGL_DEFAULT_DISPLAY)
        val ver = IntArray(2)
        check(EGL14.eglInitialize(dpy, ver, 0, ver, 1)) { "eglInitialize" }
        val attrs = intArrayOf(
            EGL14.EGL_RED_SIZE, 8, EGL14.EGL_GREEN_SIZE, 8, EGL14.EGL_BLUE_SIZE, 8, EGL14.EGL_ALPHA_SIZE, 8,
            EGL14.EGL_RENDERABLE_TYPE, EGL14.EGL_OPENGL_ES2_BIT,
            EGLExt.EGL_RECORDABLE_ANDROID, 1,
            EGL14.EGL_SURFACE_TYPE, EGL14.EGL_WINDOW_BIT or EGL14.EGL_PBUFFER_BIT,
            EGL14.EGL_NONE,
        )
        val configs = arrayOfNulls<EGLConfig>(1)
        val n = IntArray(1)
        check(EGL14.eglChooseConfig(dpy, attrs, 0, configs, 0, 1, n, 0) && n[0] > 0) { "no recordable EGL config" }
        cfg = configs[0]
        ctx = EGL14.eglCreateContext(dpy, cfg, EGL14.EGL_NO_CONTEXT, intArrayOf(EGL14.EGL_CONTEXT_CLIENT_VERSION, 2, EGL14.EGL_NONE), 0)
        check(ctx != EGL14.EGL_NO_CONTEXT) { "eglCreateContext" }
        pbuffer = EGL14.eglCreatePbufferSurface(dpy, cfg, intArrayOf(EGL14.EGL_WIDTH, 1, EGL14.EGL_HEIGHT, 1, EGL14.EGL_NONE), 0)
        check(EGL14.eglMakeCurrent(dpy, pbuffer, pbuffer, ctx)) { "eglMakeCurrent" }

        prog = program(VS, FS)
        val t = IntArray(1)
        GLES20.glGenTextures(1, t, 0)
        tex = t[0]
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
        GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)

        st = SurfaceTexture(tex)
        st.setDefaultBufferSize(w, h0)
        outW = w; outH = h0
        st.setOnFrameAvailableListener({ onFrame() }, h)
        input = Surface(st)
    }

    private fun onFrame() {
        if (dpy == EGL14.EGL_NO_DISPLAY) return
        try {
            if (out == EGL14.EGL_NO_SURFACE) {
                EGL14.eglMakeCurrent(dpy, pbuffer, pbuffer, ctx)
                st.updateTexImage()   // take the frame so the screen can send the next one
                return
            }
            EGL14.eglMakeCurrent(dpy, out, out, ctx)
            st.updateTexImage()
            screenFrames++
            if (coverOn) return   // the screen is taken (so it can send the next one) but not shown
            if (holding) return   // the game is off the screen (black comes): the kept picture is drawn instead
            val ts = st.timestamp
            val f = fpsCap.takeIf { it in 1 until fps } ?: fps
            val streamDue = !(f > 0 && lastNs > 0 && ts - lastNs < 1_000_000_000L / f * 9 / 10)
            // 7.0: the recording beside the stream keeps its own frame rate (the stream may be at 30 on a narrow link)
            val recDue = out3 != EGL14.EGL_NO_SURFACE && !(fps3 > 0 && lastRecNs > 0 && ts - lastRecNs < 1_000_000_000L / fps3 * 9 / 10)
            if (!streamDue && !recDue) return
            st.getTransformMatrix(stMatrix)
            if (recDue) { lastRecNs = ts; drawRec(ts) }
            if (!streamDue) return
            lastNs = ts
            draw()
            if (probeAt != null) readProbe()
            latchExternals()
            drawLayers()
            present(ts)
            drawn++
            if (flowing && System.nanoTime() - lastBarsNs > 500_000_000L) {
                lastBarsNs = System.nanoTime()
                try { findBars() } catch (t: Throwable) { drawError = "bars: " + (t.message ?: t.javaClass.simpleName) }
            }
        } catch (t: Throwable) { drawError = "frame: " + (t.message ?: t.javaClass.simpleName) }
    }

    /** [tw]×[th]: the pixel the look's sharpening works on (the stream's, or the recording's own). */
    private fun draw(vx: Int = 0, vy: Int = 0, vw: Int = outW, vh: Int = outH, tw: Int = outW, th: Int = outH) {
        GLES20.glViewport(vx, vy, vw, vh)
        GLES20.glUseProgram(prog)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(prog, "tex"), 0)
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(prog, "stm"), 1, false, stMatrix, 0)
        GLES20.glUniform2f(GLES20.glGetUniformLocation(prog, "texel"), 1f / tw.coerceAtLeast(1), 1f / th.coerceAtLeast(1))
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "sharp"), look.sharp)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "contrast"), look.contrast)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "bright"), look.brightness)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "sat"), look.saturation)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "vib"), look.vibrance)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "warm"), look.warmth)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "clarity"), look.clarity)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "dither"), look.dither)
        GLES20.glUniform4f(GLES20.glGetUniformLocation(prog, "region"), region[0], region[1], region[2], region[3])
        val pos = GLES20.glGetAttribLocation(prog, "pos")
        GLES20.glEnableVertexAttribArray(pos)
        GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, QUAD)
        GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        GLES20.glDisableVertexAttribArray(pos)
    }

    private fun program(vs: String, fs: String): Int {
        fun shader(type: Int, src: String): Int {
            val s = GLES20.glCreateShader(type)
            GLES20.glShaderSource(s, src)
            GLES20.glCompileShader(s)
            val ok = IntArray(1)
            GLES20.glGetShaderiv(s, GLES20.GL_COMPILE_STATUS, ok, 0)
            check(ok[0] != 0) { "shader: " + GLES20.glGetShaderInfoLog(s) }
            return s
        }
        val p = GLES20.glCreateProgram()
        GLES20.glAttachShader(p, shader(GLES20.GL_VERTEX_SHADER, vs))
        GLES20.glAttachShader(p, shader(GLES20.GL_FRAGMENT_SHADER, fs))
        GLES20.glLinkProgram(p)
        val ok = IntArray(1)
        GLES20.glGetProgramiv(p, GLES20.GL_LINK_STATUS, ok, 0)
        check(ok[0] != 0) { "link: " + GLES20.glGetProgramInfoLog(p) }
        return p
    }

    companion object {
        private const val BARS_W = 160
        private const val BARS_H = 100

        /**
         * The part of a screen picture ([px], RGBA rows from the bottom) that holds the picture, as
         * x, y, width, height fractions — the frame's own shape, so nothing is stretched — or the
         * whole screen. Only bars the system makes count: black, the same on both sides (a dark
         * scene or a small button on a bar does not). Null = nothing to go by (all black).
         */
        fun barsRegion(px: ByteArray, w: Int, h: Int): FloatArray? {
            fun lit(x: Int, y: Int): Boolean {
                val i = (y * w + x) * 4
                return (px[i].toInt() and 255) > 16 || (px[i + 1].toInt() and 255) > 16 || (px[i + 2].toInt() and 255) > 16
            }
            // a row / column is picture when at least 15 % of it is not black (a button on a bar is less)
            val rows = (0 until h).map { y -> (0 until w).count { x -> lit(x, y) } * 100 >= w * 15 }
            val cols = (0 until w).map { x -> (0 until h).count { y -> lit(x, y) } * 100 >= h * 15 }
            val y0 = rows.indexOfFirst { it }; val y1 = rows.indexOfLast { it }
            val x0 = cols.indexOfFirst { it }; val x1 = cols.indexOfLast { it }
            if (y0 < 0 || x0 < 0) return null
            val l = x0.toFloat() / w; val r = (x1 + 1).toFloat() / w
            val b = y0.toFloat() / h; val t = (y1 + 1).toFloat() / h
            val whole = floatArrayOf(0f, 0f, 1f, 1f)
            val centred = kotlin.math.abs(l - (1f - r)) < 0.04f && kotlin.math.abs(b - (1f - t)) < 0.04f
            val s = maxOf(r - l, t - b)
            if (!centred || s > 0.9f) return whole
            val cx = (l + r) / 2f; val cy = (b + t) / 2f
            return floatArrayOf((cx - s / 2f).coerceIn(0f, 1f - s), (cy - s / 2f).coerceIn(0f, 1f - s), s, s)
        }

        private val QUAD: FloatBuffer = ByteBuffer.allocateDirect(8 * 4).order(ByteOrder.nativeOrder()).asFloatBuffer().apply {
            put(floatArrayOf(-1f, -1f, 1f, -1f, -1f, 1f, 1f, 1f)); position(0)
        }

        private const val VS_COVER = """
attribute vec2 pos;
varying vec2 uv;
void main() {
    gl_Position = vec4(pos, 0.0, 1.0);
    uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
}
"""

        private const val FS_COVER = """
precision mediump float;
uniform sampler2D tex;
varying vec2 uv;
void main() { gl_FragColor = texture2D(tex, uv); }
"""

        private val FULL = floatArrayOf(0f, 0f, 1f, 1f)

        // A layer: its rectangle turned about its centre, in output pixels; uv from the crop.
        private const val VS_LAYER = """
attribute vec2 pos;
uniform vec2 center;
uniform vec2 size;
uniform vec2 outSize;
uniform float angle;
uniform vec4 crop;
uniform float mirror;
varying vec2 uv;
varying vec2 lp;
void main() {
    vec2 p = pos * 0.5 + 0.5;
    vec2 local = vec2(p.x - 0.5, 0.5 - p.y) * size;
    float c = cos(angle);
    float s = sin(angle);
    vec2 px = center + vec2(local.x * c - local.y * s, local.x * s + local.y * c);
    gl_Position = vec4(px.x / outSize.x * 2.0 - 1.0, 1.0 - px.y / outSize.y * 2.0, 0.0, 1.0);
    float u = mirror > 0.5 ? 1.0 - p.x : p.x;
    uv = vec2(mix(crop.x, crop.z, u), mix(crop.y, crop.w, 1.0 - p.y));
    lp = vec2(p.x, 1.0 - p.y) * size;
}
"""

        // Rounded corners (a circle when the radius is half the short side), soft-edged.
        private const val ROUND = """
float rr(vec2 p, vec2 s, float r) {
    vec2 q = abs(p - s * 0.5) - (s * 0.5 - vec2(r));
    return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
"""

        // pixel positions up to 1920 need more than mediump (fp16 steps by 1 px there) for smooth corners
        private const val PRECISION = """
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
"""

        private const val FS_LAYER = PRECISION + """
uniform sampler2D tex;
uniform float alpha;
uniform float corner;
uniform vec2 box;
varying vec2 uv;
varying vec2 lp;
""" + ROUND + """
void main() {
    float k = corner > 0.0 ? clamp(0.5 - rr(lp, box, corner), 0.0, 1.0) : 1.0;
    gl_FragColor = texture2D(tex, uv) * alpha * k;
}
"""

        // Video / camera frames (opaque): the producer's transform, premultiplied out.
        private const val FS_LAYER_EXT = """
#extension GL_OES_EGL_image_external : require
""" + PRECISION + """
uniform samplerExternalOES tex;
uniform mat4 stm;
uniform float alpha;
uniform float corner;
uniform vec2 box;
varying vec2 uv;
varying vec2 lp;
""" + ROUND + """
void main() {
    float k = (corner > 0.0 ? clamp(0.5 - rr(lp, box, corner), 0.0, 1.0) : 1.0) * alpha;
    vec2 t = (stm * vec4(uv.x, 1.0 - uv.y, 0.0, 1.0)).xy;
    gl_FragColor = vec4(texture2D(tex, t).rgb * k, k);
}
"""

        private const val VS = """
attribute vec2 pos;
uniform mat4 stm;
uniform vec4 region;
varying vec2 uv;
void main() {
    gl_Position = vec4(pos, 0.0, 1.0);
    uv = (stm * vec4(region.xy + (pos * 0.5 + 0.5) * region.zw, 0.0, 1.0)).xy;
}
"""

        /** A picture of the frame's own orientation (the kept last picture) over the whole viewport. */
        private const val VS_HELD = """
attribute vec2 pos;
varying vec2 uv;
void main() {
    gl_Position = vec4(pos, 0.0, 1.0);
    uv = pos * 0.5 + 0.5;
}
"""

        /** The screen as it is (no look): what the black-bar check reads. */
        private const val FS_PLAIN = """
#extension GL_OES_EGL_image_external : require
precision mediump float;
uniform samplerExternalOES tex;
varying vec2 uv;
void main() {
    gl_FragColor = texture2D(tex, uv);
}
"""

        // Sharpening: centre minus the mean of its four neighbours, cored (fine noise untouched),
        // scaled and limited (no halos). Then contrast around mid-grey, brightness, saturation
        // with vibrance (dull colours gain more than already strong ones), warmth.
        private const val FS = """
#extension GL_OES_EGL_image_external : require
precision highp float;
uniform samplerExternalOES tex;
uniform vec2 texel;
uniform float sharp;
uniform float clarity;
uniform float contrast;
uniform float bright;
uniform float sat;
uniform float vib;
uniform float warm;
uniform float dither;
varying vec2 uv;
const vec3 W = vec3(0.2126, 0.7152, 0.0722);
float lum(vec2 p) { return dot(texture2D(tex, p).rgb, W); }
void main() {
    vec3 c = texture2D(tex, uv).rgb;
    float y = dot(c, W);
    // Fine sharpening, on brightness only (no colour fringes, no bits spent on colour noise):
    // the pixel minus the mean of its four neighbours, cored so grain and compression speckle stay
    // as they are, limited so edges get no halos.
    if (sharp > 0.0) {
        float n = (lum(uv + vec2(texel.x, 0.0)) + lum(uv - vec2(texel.x, 0.0))
                 + lum(uv + vec2(0.0, texel.y)) + lum(uv - vec2(0.0, texel.y))) * 0.25;
        float d = y - n;
        d = sign(d) * max(abs(d) - 0.012, 0.0);
        c += vec3(clamp(d * sharp * 1.6, -0.07, 0.07));
    }
    // «جزئیاتِ دور» (local clarity): the same at about three pixels, the scale of far-away
    // outlines, and things faint in haze or fog — what the screen's own enhancement shows and a
    // plain capture loses. Four diagonal samples keep it light for the GPU.
    if (clarity > 0.0) {
        vec2 r = texel * 3.0;
        float m = (lum(uv + r) + lum(uv - r) + lum(uv + vec2(r.x, -r.y)) + lum(uv + vec2(-r.x, r.y))) * 0.25;
        float d = y - m;
        d = sign(d) * max(abs(d) - 0.008, 0.0);
        c += vec3(clamp(d * clarity * 1.3, -0.09, 0.09));
    }
    c = (c - 0.5) * contrast + 0.5 + bright;
    float l = dot(c, W);
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float s = sat * (1.0 + vib * (1.0 - clamp(mx - mn, 0.0, 1.0)));
    c = mix(vec3(l), c, s);
    c += vec3(warm, warm * 0.2, -warm) * 0.5;
    // Half a step of noise before the 8-bit output: stretched gradients (sky, fog, shadows) stay
    // smooth instead of turning into bands.
    c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) * dither / 255.0;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
"""
    }
}
