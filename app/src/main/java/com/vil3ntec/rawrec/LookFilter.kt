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
 * into the encoder's surface with sharpening (unsharp mask, limited so edges get no halos),
 * contrast, brightness, colour (saturation + vibrance) and warmth. One full-screen pass of five
 * texture reads: for a phone GPU at 2400×1504 × 60 fps this is a fraction of a millisecond per
 * frame, far below what a game uses, and only when a look other than «طبیعی» is chosen (otherwise
 * the screen still goes straight into the encoder, as before).
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
    ) {
        val neutral get() = sharp == 0f && contrast == 1f && brightness == 0f && saturation == 1f && vibrance == 0f && warmth == 0f
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
            val ts = st.timestamp
            if (fps > 0 && lastNs > 0 && ts - lastNs < 1_000_000_000L / fps * 9 / 10) return
            lastNs = ts
            st.getTransformMatrix(stMatrix)
            draw()
            EGLExt.eglPresentationTimeANDROID(dpy, out, ts)
            EGL14.eglSwapBuffers(dpy, out)
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
uniform float contrast;
uniform float bright;
uniform float sat;
uniform float vib;
uniform float warm;
varying vec2 uv;
void main() {
    vec3 c = texture2D(tex, uv).rgb;
    if (sharp > 0.0) {
        vec3 n = texture2D(tex, uv + vec2(texel.x, 0.0)).rgb + texture2D(tex, uv - vec2(texel.x, 0.0)).rgb
               + texture2D(tex, uv + vec2(0.0, texel.y)).rgb + texture2D(tex, uv - vec2(0.0, texel.y)).rgb;
        vec3 d = c - n * 0.25;
        // Coring: differences smaller than fine noise are left alone, so grain and compression
        // speckle are not made stronger — only real edges and detail get sharper.
        d = sign(d) * max(abs(d) - 0.012, 0.0);
        c += clamp(d * (sharp * 1.6), vec3(-0.07), vec3(0.07));
    }
    c = (c - 0.5) * contrast + 0.5 + bright;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    float mx = max(c.r, max(c.g, c.b));
    float mn = min(c.r, min(c.g, c.b));
    float s = sat * (1.0 + vib * (1.0 - clamp(mx - mn, 0.0, 1.0)));
    c = mix(vec3(l), c, s);
    c += vec3(warm, warm * 0.2, -warm) * 0.5;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
"""
    }
}
