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
    class Layer(val id: Int, val bitmap: android.graphics.Bitmap, val gen: Int, val x: Float, val y: Float, val w: Float, val h: Float, val alpha: Float)

    @Volatile private var layers: List<Layer> = emptyList()
    private val layerTex = HashMap<Int, IntArray>()   // id → [texture, gen]
    private var layerProg = 0
    private var lastPts = 0L
    private var lastDrawNs = 0L

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
            val t = layerTex.getOrPut(l.id) {
                val a = IntArray(1)
                GLES20.glGenTextures(1, a, 0)
                intArrayOf(a[0], -1)
            }
            if (t[1] == l.gen || l.bitmap.isRecycled) continue
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t[0])
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            android.opengl.GLUtils.texImage2D(GLES20.GL_TEXTURE_2D, 0, l.bitmap, 0)
            t[1] = l.gen
        }
    }

    /** The layers over what was just drawn; Android bitmaps are premultiplied, so ONE / 1−α. */
    private fun drawLayers() {
        val list = layers
        if (list.isEmpty()) return
        if (layerProg == 0) layerProg = program(VS_LAYER, FS_COVER_A)
        GLES20.glViewport(0, 0, outW, outH)
        GLES20.glUseProgram(layerProg)
        GLES20.glEnable(GLES20.GL_BLEND)
        GLES20.glBlendFunc(GLES20.GL_ONE, GLES20.GL_ONE_MINUS_SRC_ALPHA)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(layerProg, "tex"), 0)
        val rect = GLES20.glGetUniformLocation(layerProg, "rect")
        val alpha = GLES20.glGetUniformLocation(layerProg, "alpha")
        val pos = GLES20.glGetAttribLocation(layerProg, "pos")
        GLES20.glEnableVertexAttribArray(pos)
        GLES20.glVertexAttribPointer(pos, 2, GLES20.GL_FLOAT, false, 0, QUAD)
        for (l in list) {
            val t = layerTex[l.id] ?: continue
            if (t[1] != l.gen || l.alpha <= 0f) continue
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, t[0])
            GLES20.glUniform4f(rect, l.x, l.y, l.x + l.w, l.y + l.h)
            GLES20.glUniform1f(alpha, l.alpha.coerceIn(0f, 1f))
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
        }
        GLES20.glDisableVertexAttribArray(pos)
        GLES20.glDisable(GLES20.GL_BLEND)
    }

    /** Frame times only ever go forward (the screen's and the cover's / refresh's clocks meet here). */
    private fun present(ts: Long) {
        val t = if (ts <= lastPts) lastPts + 1_000 else ts
        lastPts = t
        lastDrawNs = System.nanoTime()
        EGLExt.eglPresentationTimeANDROID(dpy, out, t)
        EGL14.eglSwapBuffers(dpy, out)
    }

    /**
     * A still screen sends no new frames, so a changed overlay would wait for the next one: the last
     * screen picture is drawn again with the overlay (only when nothing came for a while).
     */
    private fun refresh() {
        if (out == EGL14.EGL_NO_SURFACE || coverOn || drawn == 0L) return
        if (System.nanoTime() - lastDrawNs < 120_000_000L) return
        try {
            EGL14.eglMakeCurrent(dpy, out, out, ctx)
            draw()
            drawLayers()
            present(System.nanoTime())
        } catch (_: Throwable) {}
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
        st.setDefaultBufferSize(w, h0)
        outW = w; outH = h0
        if (s != null && s.isValid) {
            out = EGL14.eglCreateWindowSurface(dpy, cfg, s, intArrayOf(EGL14.EGL_NONE), 0)
            if (out == EGL14.EGL_NO_SURFACE) throw IllegalStateException("eglCreateWindowSurface 0x" + Integer.toHexString(EGL14.eglGetError()))
        }
    }

    fun release() {
        runSync {
            try { if (::st.isInitialized) st.release() } catch (_: Throwable) {}
            try { if (::input.isInitialized) input.release() } catch (_: Throwable) {}
            if (dpy != EGL14.EGL_NO_DISPLAY) {
                EGL14.eglMakeCurrent(dpy, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_SURFACE, EGL14.EGL_NO_CONTEXT)
                if (out != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(dpy, out)
                if (pbuffer != EGL14.EGL_NO_SURFACE) EGL14.eglDestroySurface(dpy, pbuffer)
                if (ctx != EGL14.EGL_NO_CONTEXT) EGL14.eglDestroyContext(dpy, ctx)
                EGL14.eglTerminate(dpy)
            }
            out = EGL14.EGL_NO_SURFACE; pbuffer = EGL14.EGL_NO_SURFACE; ctx = EGL14.EGL_NO_CONTEXT; dpy = EGL14.EGL_NO_DISPLAY
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
            if (coverOn) return   // the screen is taken (so it can send the next one) but not shown
            val ts = st.timestamp
            if (fps > 0 && lastNs > 0 && ts - lastNs < 1_000_000_000L / fps * 9 / 10) return
            lastNs = ts
            st.getTransformMatrix(stMatrix)
            draw()
            if (probeAt != null) readProbe()
            drawLayers()
            present(ts)
            drawn++
        } catch (_: Throwable) {}
    }

    private fun draw() {
        GLES20.glViewport(0, 0, outW, outH)
        GLES20.glUseProgram(prog)
        GLES20.glActiveTexture(GLES20.GL_TEXTURE0)
        GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, tex)
        GLES20.glUniform1i(GLES20.glGetUniformLocation(prog, "tex"), 0)
        GLES20.glUniformMatrix4fv(GLES20.glGetUniformLocation(prog, "stm"), 1, false, stMatrix, 0)
        GLES20.glUniform2f(GLES20.glGetUniformLocation(prog, "texel"), 1f / outW.coerceAtLeast(1), 1f / outH.coerceAtLeast(1))
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "sharp"), look.sharp)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "contrast"), look.contrast)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "bright"), look.brightness)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "sat"), look.saturation)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "vib"), look.vibrance)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "warm"), look.warmth)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "clarity"), look.clarity)
        GLES20.glUniform1f(GLES20.glGetUniformLocation(prog, "dither"), look.dither)
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

        private const val VS_LAYER = """
attribute vec2 pos;
uniform vec4 rect;
varying vec2 uv;
void main() {
    vec2 p = pos * 0.5 + 0.5;
    uv = vec2(p.x, 1.0 - p.y);
    float x = mix(rect.x, rect.z, p.x);
    float y = mix(rect.w, rect.y, p.y);
    gl_Position = vec4(x * 2.0 - 1.0, 1.0 - y * 2.0, 0.0, 1.0);
}
"""

        private const val FS_COVER_A = """
precision mediump float;
uniform sampler2D tex;
uniform float alpha;
varying vec2 uv;
void main() { gl_FragColor = texture2D(tex, uv) * alpha; }
"""

        private const val VS = """
attribute vec2 pos;
uniform mat4 stm;
varying vec2 uv;
void main() {
    gl_Position = vec4(pos, 0.0, 1.0);
    uv = (stm * vec4(pos * 0.5 + 0.5, 0.0, 1.0)).xy;
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
