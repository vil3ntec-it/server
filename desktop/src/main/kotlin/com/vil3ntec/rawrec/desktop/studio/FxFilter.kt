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
 * A layer's green screen and sharpening, done by FFmpeg's filters (SIMD C) on the source's own thread at
 * the size it is shown — never per pixel in the drawing: chromakey in the colour plane as OBS keys,
 * despill for the edges, unsharp for detail. BGRA in, BGRA with alpha out. One per source; made again
 * only when the size or the settings change.
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

        fun desc(f: Fx): String {
            val parts = ArrayList<String>()
            if (f.sharpen > 0f) parts.add("unsharp=lx=5:ly=5:la=${"%.2f".format(java.util.Locale.US, f.sharpen * 1.5f)}:cx=5:cy=5:ca=0")
            if (f.key) {
                val c = "0x%06X".format(f.keyColor and 0xFFFFFF)
                // OBS's similarity (0..1, default 0.4) and smoothness (0.08) → chromakey's own scale. Measured on a card of
                // bright, shaded and light greens against red, skin, white and denim: 0.24–0.32 keys every green and keeps the rest; 0.4 → 0.28
                parts.add("format=yuva444p")
                parts.add("chromakey=color=$c:similarity=${"%.3f".format(java.util.Locale.US, (f.similarity * 0.7f).coerceIn(0.01f, 1f))}:blend=${"%.3f".format(java.util.Locale.US, (f.smoothness * 0.6f).coerceIn(0f, 1f))}")
                if (f.spill > 0f) {
                    val g = f.keyColor shr 8 and 0xFF; val b = f.keyColor and 0xFF
                    parts.add("format=gbrap,despill=type=${if (b > g) "blue" else "green"}:mix=${"%.2f".format(java.util.Locale.US, (f.spill * 4f).coerceIn(0f, 1f))}:expand=0")
                }
            }
            parts.add("format=bgra")
            return parts.joinToString(",")
        }

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

    private fun premultiply(p: ByteArray) {
        val t = PREMUL
        var i = 0
        while (i < p.size) {
            val a = p[i + 3].toInt() and 0xFF
            if (a != 255) {
                val row = a shl 8
                p[i] = t[row or (p[i].toInt() and 0xFF)]; p[i + 1] = t[row or (p[i + 1].toInt() and 0xFF)]; p[i + 2] = t[row or (p[i + 2].toInt() and 0xFF)]
            }
            i += 4
        }
    }

    /** [bgra] (w×h, packed) through the effects; the result premultiplied when keyed; null when nothing is needed or the filter failed. */
    fun apply(bgra: ByteArray, w: Int, h: Int, f: Fx): ByteArray? {
        if (!needed(f)) return null
        try {
            val k = listOf(w, h, f.key, f.keyColor, f.similarity, f.smoothness, f.spill, f.sharpen)
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
            // premultiplied once here (on the source's thread), so the drawing never converts it again
            if (f.key) premultiply(out)
            error = null
            return out
        } catch (t: Throwable) { error = t.message; key = null; return null }
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
