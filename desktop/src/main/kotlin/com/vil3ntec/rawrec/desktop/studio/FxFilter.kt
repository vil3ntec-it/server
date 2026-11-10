package com.vil3ntec.rawrec.desktop.studio

import com.vil3ntec.rawrec.desktop.VideoDecoder
import org.bytedeco.ffmpeg.avfilter.AVFilterContext
import org.bytedeco.ffmpeg.global.avfilter.*
import org.bytedeco.ffmpeg.global.avutil.*
import org.bytedeco.javacpp.BytePointer
import org.bytedeco.javacpp.Pointer
import org.jetbrains.skia.ColorFilter
import org.jetbrains.skia.ColorMatrix
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin

/**
 * A layer's green screen and sharpening on the source's own thread at the size it is shown — never per pixel in the
 * drawing. Sharpening is FFmpeg's unsharp (SIMD C, luma only). The key is one integer pass over the picture that does
 * what FFmpeg's chromakey does (BT.601 limited-range chroma, distance averaged over 3×3, the same similarity and blend
 * scale, so the measured settings mean the same) together with despill and premultiplication — chromakey alone took
 * 21 of 28 ms at 720p, this pass a few. BGRA in, premultiplied BGRA with alpha out. One per source.
 */
class FxFilter : AutoCloseable {
    private var graph: org.bytedeco.ffmpeg.avfilter.AVFilterGraph? = null
    private var src = AVFilterContext(null as Pointer?)
    private var sink = AVFilterContext(null as Pointer?)
    private val inF = av_frame_alloc()
    private val outF = av_frame_alloc()
    private var key: Any? = null
    @Volatile var error: String? = null; private set

    /** True when this effect needs the filter at all (colour correction alone is done in the drawing). */
    companion object {
        /** c·a/255 for every alpha a and colour c (64 KB, made once). */
        private val PREMUL = ByteArray(65536) { k -> ((k and 0xFF) * (k shr 8) / 255).toByte() }

        fun needed(f: Fx) = f.key || f.sharpen > 0f

        /** The FFmpeg part: sharpening only (the key is [key]). */
        fun desc(f: Fx): String =
            "format=yuva444p,unsharp=lx=5:ly=5:la=${"%.2f".format(java.util.Locale.US, f.sharpen * 1.5f)}:cx=5:cy=5:ca=0,format=bgra"

        /** √(d²/(255²·2)) · 4096 for every squared chroma distance d² (limited-range chroma differs by at most 224). */
        private val DIST = IntArray(2 * 224 * 224 + 1) { (Math.sqrt(it / (255.0 * 255.0 * 2)) * 4096 + 0.5).toInt() }

        /** BT.601 limited-range chroma (less its 128 offset) as swscale and chromakey compute it: coefficients · 224/255 · 2^16. */
        private fun u(r: Int, g: Int, b: Int) = (-9714 * r - 19070 * g + 28784 * b) shr 16
        private fun v(r: Int, g: Int, b: Int) = (28784 * r - 24103 * g - 4681 * b) shr 16

        /** Brightness, contrast, saturation, hue and gamma as one colour filter for the drawing (cheap on the CPU). */
        fun colorFilter(f: Fx): ColorFilter? {
            if (f.brightness == 0f && f.contrast == 1f && f.saturation == 1f && f.hue == 0f && f.gamma == 1f) return null
            val c = f.contrast; val b = f.brightness
            val t = (0.5f - 0.5f * c + b)
            val cb = floatArrayOf(c, 0f, 0f, 0f, t, 0f, c, 0f, 0f, t, 0f, 0f, c, 0f, t, 0f, 0f, 0f, 1f, 0f)
            val s = f.saturation; val lr = 0.2126f * (1 - s); val lg = 0.7152f * (1 - s); val lb = 0.0722f * (1 - s)
            val sat = floatArrayOf(lr + s, lg, lb, 0f, 0f, lr, lg + s, lb, 0f, 0f, lr, lg, lb + s, 0f, 0f, 0f, 0f, 0f, 1f, 0f)
            var m = mul(sat, cb)
            if (f.hue != 0f) {
                val h = Math.toRadians(f.hue.toDouble()); val cs = cos(h).toFloat(); val sn = sin(h).toFloat()
                val hue = floatArrayOf(
                    0.213f + cs * 0.787f - sn * 0.213f, 0.715f - cs * 0.715f - sn * 0.715f, 0.072f - cs * 0.072f + sn * 0.928f, 0f, 0f,
                    0.213f - cs * 0.213f + sn * 0.143f, 0.715f + cs * 0.285f + sn * 0.140f, 0.072f - cs * 0.072f - sn * 0.283f, 0f, 0f,
                    0.213f - cs * 0.213f - sn * 0.787f, 0.715f - cs * 0.715f + sn * 0.715f, 0.072f + cs * 0.928f + sn * 0.072f, 0f, 0f,
                    0f, 0f, 0f, 1f, 0f)
                m = mul(hue, m)
            }
            var cf: ColorFilter = ColorFilter.makeMatrix(ColorMatrix(*m))
            if (f.gamma != 1f) {
                val lut = ByteArray(256) { i -> ((i / 255.0).pow(1.0 / f.gamma) * 255 + 0.5).toInt().coerceIn(0, 255).toByte() }
                cf = ColorFilter.makeComposed(ColorFilter.makeTableARGB(null, lut, lut, lut), cf)
            }
            return cf
        }

        /** a·b for 4×5 colour matrices (b first, then a). */
        private fun mul(a: FloatArray, b: FloatArray): FloatArray {
            val r = FloatArray(20)
            for (i in 0 until 4) {
                for (j in 0 until 4) { var s = 0f; for (k in 0 until 4) s += a[i * 5 + k] * b[k * 5 + j]; r[i * 5 + j] = s }
                var t = a[i * 5 + 4]; for (k in 0 until 4) t += a[i * 5 + k] * b[k * 5 + 4]; r[i * 5 + 4] = t
            }
            return r
        }
    }

    private var dist = IntArray(0)
    private var rows = IntArray(0)
    private val alphaOf = IntArray(9 * 4096 + 1)

    /**
     * Keys [p] (w×h BGRA) in place: alpha from the chroma distance to the key colour averaged over 3×3 (as chromakey),
     * then despill (as FFmpeg's despill with expand 0: the key channel no higher than the mix of the other two), then
     * premultiplied.
     */
    fun key(p: ByteArray, w: Int, h: Int, f: Fx) {
        val n = w * h
        if (dist.size < n) { dist = IntArray(n); rows = IntArray(n) }
        val d = dist; val hs = rows; val lut = DIST
        val kr = f.keyColor shr 16 and 0xFF; val kg = f.keyColor shr 8 and 0xFF; val kb = f.keyColor and 0xFF
        val ku = u(kr, kg, kb); val kv = v(kr, kg, kb)
        var i = 0; var o = 0
        while (i < n) {
            val b = p[o].toInt() and 0xFF; val g = p[o + 1].toInt() and 0xFF; val r = p[o + 2].toInt() and 0xFF
            val du = u(r, g, b) - ku; val dv = v(r, g, b) - kv
            d[i] = lut[(du * du + dv * dv).coerceAtMost(lut.size - 1)]
            i++; o += 4
        }
        // the 3×3 sum, separable: across each row, then down (the edges repeat their last pixel)
        for (y in 0 until h) {
            val r0 = y * w
            for (x in 0 until w) {
                val c = d[r0 + x]
                hs[r0 + x] = (if (x > 0) d[r0 + x - 1] else c) + c + (if (x < w - 1) d[r0 + x + 1] else c)
            }
        }
        // key alpha for every 3×3 sum: chromakey's clip((diff − similarity) / blend) · 255
        val sim9 = (f.similarity * 0.7f).coerceIn(0.01f, 1f) * 4096 * 9
        val blend9 = (f.smoothness * 0.6f).coerceIn(0f, 1f) * 4096 * 9
        val am = alphaOf
        for (s in am.indices) am[s] = if (blend9 > 0.0001f * 4096 * 9) ((s - sim9) * 255f / blend9).toInt().coerceIn(0, 255) else if (s > sim9) 255 else 0
        val mix = ((f.spill * 4f).coerceIn(0f, 1f) * 256).toInt()
        val blueKey = kb > kg
        val t = PREMUL
        for (y in 0 until h) {
            val up = if (y > 0) (y - 1) * w else y * w; val mid = y * w; val dn = if (y < h - 1) (y + 1) * w else y * w
            var q = mid * 4
            for (x in 0 until w) {
                val ka = am[hs[up + x] + hs[mid + x] + hs[dn + x]]
                val a = t[(ka shl 8) or (p[q + 3].toInt() and 0xFF)].toInt() and 0xFF
                if (a == 0) { p[q] = 0; p[q + 1] = 0; p[q + 2] = 0; p[q + 3] = 0; q += 4; continue }
                var b = p[q].toInt() and 0xFF; var g = p[q + 1].toInt() and 0xFF; val r = p[q + 2].toInt() and 0xFF
                if (mix > 0) {
                    if (blueKey) { val lim = (r * mix + g * (256 - mix)) shr 8; if (b > lim) b = lim }
                    else { val lim = (r * mix + b * (256 - mix)) shr 8; if (g > lim) g = lim }
                }
                if (a == 255) { p[q] = b.toByte(); p[q + 1] = g.toByte() }
                else {
                    val row = a shl 8
                    p[q] = t[row or b]; p[q + 1] = t[row or g]; p[q + 2] = t[row or r]; p[q + 3] = a.toByte()
                }
                q += 4
            }
        }
    }

    /** [bgra] (w×h, packed) through the effects into a new array; premultiplied when keyed; null when nothing is needed or the filter failed. */
    fun apply(bgra: ByteArray, w: Int, h: Int, f: Fx): ByteArray? {
        if (!needed(f)) return null
        try {
            val out = if (f.sharpen > 0f) sharpen(bgra, w, h, f) ?: return null else bgra.copyOf(w * h * 4)
            if (f.key) key(out, w, h, f)
            error = null
            return out
        } catch (t: Throwable) { error = t.message; key = null; return null }
    }

    private fun sharpen(bgra: ByteArray, w: Int, h: Int, f: Fx): ByteArray? {
        val k = listOf(w, h, f.sharpen)
        if (k != key) { build(w, h, desc(f)); key = k }
        inF.width(w); inF.height(h); inF.format(AV_PIX_FMT_BGRA); inF.pts(0)
        check(av_frame_get_buffer(inF, 0) >= 0)
        val ls = inF.linesize(0)
        val dst = inF.data(0)
        if (ls == w * 4) dst.put(bgra, 0, w * h * 4) else for (y in 0 until h) dst.position(y.toLong() * ls).put(bgra, y * w * 4, w * 4)
        dst.position(0)
        check(av_buffersrc_add_frame_flags(src, inF, 0) >= 0) { "filter in" }
        av_frame_unref(inF)
        if (av_buffersink_get_frame(sink, outF) < 0) return null
        val out = ByteArray(w * h * 4)
        val ols = outF.linesize(0); val o = outF.data(0)
        if (ols == w * 4) o.get(out, 0, w * h * 4) else for (y in 0 until h) o.position(y.toLong() * ols).get(out, y * w * 4, w * 4)
        o.position(0)
        av_frame_unref(outF)
        return out
    }

    private fun build(w: Int, h: Int, desc: String) {
        graph?.let { avfilter_graph_free(it) }
        val g = avfilter_graph_alloc(); graph = g
        src = AVFilterContext(null as Pointer?); sink = AVFilterContext(null as Pointer?)
        check(avfilter_graph_create_filter(src, avfilter_get_by_name("buffer"), "in", "video_size=${w}x$h:pix_fmt=$AV_PIX_FMT_BGRA:time_base=1/30:pixel_aspect=1/1", null, g) >= 0)
        check(avfilter_graph_create_filter(sink, avfilter_get_by_name("buffersink"), "out", null as String?, null, g) >= 0)
        val outs = avfilter_inout_alloc(); outs.name(av_strdup(BytePointer("in"))); outs.filter_ctx(src); outs.pad_idx(0); outs.next(null)
        val ins = avfilter_inout_alloc(); ins.name(av_strdup(BytePointer("out"))); ins.filter_ctx(sink); ins.pad_idx(0); ins.next(null)
        val r = avfilter_graph_parse_ptr(g, desc, ins, outs, null)
        avfilter_inout_free(ins); avfilter_inout_free(outs)
        check(r >= 0) { "filters «$desc»: ${VideoDecoder.err(r)}" }
        check(avfilter_graph_config(g, null) >= 0) { "filters config" }
    }

    override fun close() {
        graph?.let { avfilter_graph_free(it) }; graph = null
        av_frame_free(inF); av_frame_free(outF)
    }
}
