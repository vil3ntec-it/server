package com.vil3ntec.rawrec.desktop.studio

import com.vil3ntec.rawrec.desktop.Session
import com.vil3ntec.rawrec.desktop.VideoDecoder
import org.bytedeco.ffmpeg.avcodec.AVCodecContext
import org.bytedeco.ffmpeg.avformat.AVFormatContext
import org.bytedeco.ffmpeg.avutil.AVDictionary
import org.bytedeco.ffmpeg.global.avcodec.*
import org.bytedeco.ffmpeg.global.avformat.*
import org.bytedeco.ffmpeg.global.avutil.*
import org.bytedeco.ffmpeg.global.swscale.*
import org.bytedeco.javacpp.BytePointer
import org.bytedeco.javacpp.DoublePointer
import org.bytedeco.javacpp.IntPointer
import org.bytedeco.javacpp.Pointer
import org.bytedeco.javacpp.PointerPointer
import org.jetbrains.skia.*
import org.jetbrains.skia.paragraph.*
import java.io.File
import java.util.concurrent.atomic.AtomicReference

/** What a layer shows, made ready on the picture thread. */
sealed interface SourceRuntime : AutoCloseable {
    override fun close() {}
}

/** Sources that are a picture (phone, webcam, video file, image). */
interface PictureSource : SourceRuntime {
    /** The newest picture, or null while there is none; called on the picture thread only. */
    fun image(): Image?
    /** The size it is shown at, from its own size: sources that decode convert straight to it (see VideoDecoder.scaleTo). */
    fun want(size: ((Int, Int) -> Pair<Int, Int>?)?) {}
    /** The layer's green screen / sharpening, done by the source on its own pictures (see [FxFilter]). */
    fun fx(f: Fx) {}
}

/** Sources drawn straight into their box (text, colour, chat, alerts), in the box's own pixels. */
interface DrawnSource : SourceRuntime {
    fun draw(c: Canvas, w: Float, h: Float)
    /**
     * What decides how it looks: the same stamp means the same picture, so the engine draws it once and
     * reuses it (text, colours, a quiet chat). Null = it moves now, draw every time.
     */
    fun stamp(w: Float, h: Float): Any? = null
}

/** BGRA pixels handed from a capture thread to the picture thread. */
class Pixels(val w: Int, val h: Int, val bgra: ByteArray, val seq: Long, val alpha: Boolean = false)

/** Turns the newest [Pixels] into a Skia image, only when they changed. */
private class LatestImage {
    private var seq = -1L
    private var img: Image? = null
    fun from(p: Pixels?): Image? {
        if (p == null) { img?.close(); img = null; seq = -1; return null }
        if (p.seq != seq) {
            img?.close()
            img = Image.makeRaster(ImageInfo(p.w, p.h, ColorType.BGRA_8888, if (p.alpha) ColorAlphaType.PREMUL else ColorAlphaType.OPAQUE), p.bgra, p.w * 4)
            seq = p.seq
        }
        return img
    }
    fun close() { img?.close(); img = null }
}

/** The phone on the cable: whatever [Session] decoded last. */
class PhoneSource(private val session: () -> Session?) : PictureSource {
    private val latest = LatestImage()
    private val filter = FxFilter()
    @Volatile private var fx = Fx()
    private var keyed: Pixels? = null
    override fun want(size: ((Int, Int) -> Pair<Int, Int>?)?) { session()?.scaleTo = size }
    override fun fx(f: Fx) { fx = f }
    override fun image(): Image? {
        val p = session()?.latest?.get() ?: return latest.from(null)
        val f = fx
        if (!FxFilter.needed(f)) return latest.from(Pixels(p.width, p.height, p.bgra, p.seq))
        val k = keyed
        if (k == null || k.seq != p.seq) keyed = filter.apply(p.bgra, p.width, p.height, f)?.let { Pixels(p.width, p.height, it, p.seq, f.key) } ?: Pixels(p.width, p.height, p.bgra, p.seq)
        return latest.from(keyed)
    }
    override fun close() { latest.close(); filter.close() }
}

/** A still picture from a file (PNG, JPEG, WebP, …). */
class ImageFileSource(path: String) : PictureSource {
    private val img: Image? = try { Image.makeFromEncoded(File(path).readBytes()) } catch (_: Exception) { null }
    private var fx = Fx()
    private var treated: Image? = null
    private var treatedFor: Fx? = null
    private var size: ((Int, Int) -> Pair<Int, Int>?)? = null
    private var scaled: Image? = null
    private var scaledFor: Any? = null
    override fun fx(f: Fx) { fx = f }
    override fun want(size: ((Int, Int) -> Pair<Int, Int>?)?) { this.size = size }
    override fun image(): Image? {
        val base = treatedImage() ?: return null
        // brought once to the size it is shown at (drawn 1:1 every picture after that)
        val want = size?.invoke(base.width, base.height) ?: return base
        val k = listOf(System.identityHashCode(base), want)
        if (k != scaledFor) {
            scaled?.close(); scaledFor = k
            scaled = Surface.makeRasterN32Premul(want.first.coerceAtLeast(1), want.second.coerceAtLeast(1)).use { s ->
                s.canvas.drawImageRect(base, Rect.makeWH(base.width.toFloat(), base.height.toFloat()), Rect.makeWH(want.first.toFloat(), want.second.toFloat()),
                    if (want.first < base.width) FilterMipmap(FilterMode.LINEAR, MipmapMode.LINEAR) else CubicResampler(1 / 3f, 1 / 3f), null, true)
                s.makeImageSnapshot()
            }
        }
        return scaled
    }
    private fun treatedImage(): Image? {
        val i = img ?: return null
        val f = fx
        if (!FxFilter.needed(f)) return i
        if (treatedFor != f) {
            treated?.close(); treated = null; treatedFor = f
            val bm = Bitmap.makeFromImage(i)
            val info = ImageInfo(i.width, i.height, ColorType.BGRA_8888, ColorAlphaType.UNPREMUL)
            val px = bm.readPixels(info, i.width * 4, 0, 0)
            bm.close()
            if (px != null) FxFilter().use { flt -> flt.apply(px, i.width, i.height, f) }?.let { out ->
                treated = Image.makeRaster(ImageInfo(i.width, i.height, ColorType.BGRA_8888, ColorAlphaType.PREMUL), out, i.width * 4) }
        }
        return treated ?: i
    }
    override fun close() { img?.close(); treated?.close(); scaled?.close() }
}

/**
 * A webcam (the system's own capture: DirectShow, AVFoundation, Video4Linux) or a video file played in a
 * loop, decoded on its own thread; the picture thread takes the newest picture, never waits for one.
 */
class MediaSource(
    private val format: String?, private val url: String, private val loop: Boolean, private val options: Map<String, String> = emptyMap(),
    /** Where the file's own sound goes (a mixer input); null = picture only. */
    private val sound: AudioInput? = null,
) : PictureSource {
    private val newest = AtomicReference<Pixels?>(null)
    private val latest = LatestImage()
    @Volatile private var scaleTo: ((Int, Int) -> Pair<Int, Int>?)? = null
    override fun want(size: ((Int, Int) -> Pair<Int, Int>?)?) { scaleTo = size }
    @Volatile private var fxNow = Fx()
    override fun fx(f: Fx) { fxNow = f }
    private val filter = FxFilter()
    @Volatile private var running = true
    @Volatile var error: String? = null; private set
    private val thread = Thread({ run() }, "source-$url").apply { isDaemon = true; start() }

    override fun image(): Image? = latest.from(newest.get())

    private fun run() {
        var seq = 0L
        while (running) {
            try {
                val ic = AVFormatContext(null as Pointer?)
                val capErr = if (format != null) Devices.captureError else null
                if (capErr != null) { error = capErr; Thread.sleep(5000); continue }
                val fmt = format?.let { av_find_input_format(it) }
                val opts = AVDictionary(null as Pointer?)
                for ((k, v) in options) av_dict_set(opts, k, v, 0)
                val r = avformat_open_input(ic, url, fmt, opts)
                av_dict_free(opts)
                if (r < 0) { error = VideoDecoder.err(r); Thread.sleep(2000); continue }
                try {
                    avformat_find_stream_info(ic, null as PointerPointer<*>?)
                    val vi = av_find_best_stream(ic, AVMEDIA_TYPE_VIDEO, -1, -1, null as org.bytedeco.ffmpeg.avcodec.AVCodec?, 0)
                    if (vi < 0) { error = "no picture in it"; return }
                    val st = ic.streams(vi)
                    val codec = avcodec_find_decoder(st.codecpar().codec_id()) ?: run { error = "unknown picture format"; return }
                    val dec: AVCodecContext = avcodec_alloc_context3(codec)
                    avcodec_parameters_to_context(dec, st.codecpar())
                    dec.thread_count(0)
                    check(avcodec_open2(dec, codec, null as AVDictionary?) >= 0)
                    error = null
                    val pkt = av_packet_alloc(); val frm = av_frame_alloc(); val afrm = av_frame_alloc()
                    var sws: org.bytedeco.ffmpeg.swscale.SwsContext? = null
                    // the file's sound, converted to the mixer's 48 kHz stereo 16-bit
                    val ai = if (sound != null && format == null) av_find_best_stream(ic, AVMEDIA_TYPE_AUDIO, -1, vi, null as org.bytedeco.ffmpeg.avcodec.AVCodec?, 0) else -1
                    val adec: AVCodecContext? = if (ai >= 0) avcodec_find_decoder(ic.streams(ai).codecpar().codec_id())?.let { c ->
                        avcodec_alloc_context3(c).also { d -> avcodec_parameters_to_context(d, ic.streams(ai).codecpar()); if (avcodec_open2(d, c, null as AVDictionary?) < 0) avcodec_free_context(d) }
                    } else null
                    val swr = adec?.let { d ->
                        val out = org.bytedeco.ffmpeg.avutil.AVChannelLayout(); av_channel_layout_default(out, 2)
                        val c = org.bytedeco.ffmpeg.swresample.SwrContext(null as Pointer?)
                        if (org.bytedeco.ffmpeg.global.swresample.swr_alloc_set_opts2(c, out, AV_SAMPLE_FMT_S16, 48_000, d.ch_layout(), d.sample_fmt(), d.sample_rate(), 0, null) >= 0
                            && org.bytedeco.ffmpeg.global.swresample.swr_init(c) >= 0) c else null
                    }
                    // one clock for the file's picture and sound: each waits for its own time, so they stay together
                    var t0Ns = 0L; var firstSec = Double.NaN
                    fun waitFor(sec: Double) {
                        if (format != null || sec.isNaN()) return
                        if (firstSec.isNaN()) { firstSec = sec; t0Ns = System.nanoTime() }
                        val wait = t0Ns + ((sec - firstSec) * 1e9).toLong() - System.nanoTime()
                        if (wait > 0) Thread.sleep(wait / 1_000_000, (wait % 1_000_000).toInt())
                    }
                    fun secOf(f: org.bytedeco.ffmpeg.avutil.AVFrame, stream: Int): Double {
                        val p = f.best_effort_timestamp(); return if (p == AV_NOPTS_VALUE) Double.NaN else p * av_q2d(ic.streams(stream).time_base())
                    }
                    try {
                        while (running && av_read_frame(ic, pkt) >= 0) {
                            if (pkt.stream_index() == vi && avcodec_send_packet(dec, pkt) >= 0) {
                                while (avcodec_receive_frame(dec, frm) >= 0) {
                                    val sw = frm.width(); val sh = frm.height()
                                    val (w, h) = (scaleTo?.invoke(sw, sh) ?: (sw to sh)).let { (a, b) -> a.coerceIn(2, 7680) to b.coerceIn(2, 7680) }
                                    val fl = if (w * h < sw * sh) SWS_AREA else SWS_BICUBIC
                                    sws = sws_getCachedContext(sws, sw, sh, frm.format(), w, h, AV_PIX_FMT_BGRA, fl, null, null, null as DoublePointer?)
                                    val out = ByteArray(w * h * 4)
                                    val bp = BytePointer(out.size.toLong())
                                    val dst = PointerPointer<BytePointer>(4L).put(0L, bp); val ls = IntPointer(4L).put(0L, w * 4)
                                    sws_scale(sws, frm.data(), frm.linesize(), 0, sh, dst, ls)
                                    bp.get(out); bp.close(); dst.close(); ls.close()
                                    // a file plays at its own speed; a camera gives pictures as they come
                                    val f = fxNow
                                    val treated = if (FxFilter.needed(f)) filter.apply(out, w, h, f) else null
                                    waitFor(secOf(frm, vi))
                                    newest.set(if (treated != null) Pixels(w, h, treated, ++seq, f.key) else Pixels(w, h, out, ++seq))
                                }
                            } else if (pkt.stream_index() == ai && adec != null && swr != null && avcodec_send_packet(adec, pkt) >= 0) {
                                while (avcodec_receive_frame(adec, afrm) >= 0) {
                                    val max = afrm.nb_samples() * 2 + 256
                                    val bp = BytePointer(max.toLong() * 4)
                                    val op = PointerPointer<BytePointer>(1L).put(0L, bp)
                                    val n = org.bytedeco.ffmpeg.global.swresample.swr_convert(swr, op, max, afrm.extended_data(), afrm.nb_samples())
                                    if (n > 0) { val b = ByteArray(n * 4); bp.get(b); waitFor(secOf(afrm, ai)); sound!!.push(b) }
                                    bp.close(); op.close()
                                }
                            }
                            av_packet_unref(pkt)
                        }
                    } finally {
                        sws?.let { sws_freeContext(it) }
                        swr?.let { org.bytedeco.ffmpeg.global.swresample.swr_free(it) }
                        adec?.let { avcodec_free_context(it) }
                        av_frame_free(frm); av_frame_free(afrm); av_packet_free(pkt); avcodec_free_context(dec)
                    }
                } finally { avformat_close_input(ic) }
                if (!loop) { while (running) Thread.sleep(200) }
            } catch (e: InterruptedException) { return } catch (e: Throwable) { error = e.message ?: e.javaClass.simpleName; Thread.sleep(2000) }
        }
    }

    override fun close() { running = false; thread.interrupt(); latest.close(); thread.join(1000); filter.close() }

    companion object {
        /**
         * This computer's screen (or, on Windows, one window by its title): the system's own capture
         * (GDI on Windows, AVFoundation on macOS, X11 on Linux), with the mouse pointer.
         */
        fun screen(display: String, window: String, fps: Int): MediaSource {
            val os = System.getProperty("os.name").lowercase()
            val r = fps.coerceIn(10, 60).toString()
            return when {
                os.contains("win") -> MediaSource("gdigrab", if (window.isNotBlank()) "title=$window" else "desktop", true, mapOf("framerate" to r, "draw_mouse" to "1"))
                os.contains("mac") -> MediaSource("avfoundation", "Capture screen ${display.ifBlank { "0" }}:none", true, mapOf("framerate" to r, "capture_cursor" to "1", "pixel_format" to "bgr0"))
                else -> MediaSource("x11grab", display.ifBlank { System.getenv("DISPLAY") ?: ":0" }, true, mapOf("framerate" to r, "draw_mouse" to "1"))
            }
        }

        /** The system's camera input, by name as the system lists it. */
        fun webcam(device: String): MediaSource {
            val os = System.getProperty("os.name").lowercase()
            return when {
                os.contains("win") -> MediaSource("dshow", "video=$device", true, mapOf("rtbufsize" to "64M"))
                os.contains("mac") -> MediaSource("avfoundation", device, true, mapOf("framerate" to "30"))
                else -> MediaSource("v4l2", device, true)
            }
        }
    }
}

/** Fonts for drawn text: Vazirmatn (shipped with the app) first, so Persian is shaped right everywhere. */
object Fonts {
    val collection: FontCollection by lazy {
        val provider = TypefaceFontProvider()
        for (f in listOf("Vazirmatn-Regular.ttf", "Vazirmatn-Bold.ttf")) {
            Fonts::class.java.classLoader.getResourceAsStream("fonts/$f")?.use { s ->
                FontMgr.default.makeFromData(Data.makeFromBytes(s.readBytes()))?.let { provider.registerTypeface(it, "Vazirmatn") }
            }
        }
        FontCollection().setDefaultFontManager(FontMgr.default).setAssetFontManager(provider)
    }
    val families = arrayOf("Vazirmatn", "Segoe UI", "Noto Sans", "Helvetica", "Arial")

    fun color(s: String, def: Int): Int = try {
        val h = s.trim().removePrefix("#")
        when (h.length) { 6 -> (0xFF000000 or h.toLong(16)).toInt(); 8 -> h.toLong(16).toInt(); else -> def }
    } catch (_: Exception) { def }
}

/** Text in its box: size, colour, outline, background, alignment; right-to-left for Persian. */
class TextSource(private val def: () -> SourceDef?) : DrawnSource {
    override fun stamp(w: Float, h: Float): Any? = def()?.let { listOf(it.props, it.name, w, h) }
    private var key = ""
    private var para: Paragraph? = null
    override fun draw(c: Canvas, w: Float, h: Float) {
        val d = def() ?: return
        val text = d.prop("text", d.name)
        val size = d.prop("size", "64").toFloatOrNull() ?: 64f
        val k = "$text|$size|${d.props}|$w"
        if (k != key) {
            para?.close()
            val st = TextStyle().setFontFamilies(Fonts.families).setFontSize(size)
                .setColor(Fonts.color(d.prop("color", "#FFFFFF"), -1))
                .setFontStyle(if (d.prop("bold", "1") == "1") FontStyle.BOLD else FontStyle.NORMAL)
            if (d.prop("shadow", "1") == "1") st.addShadow(Shadow(0x99000000.toInt(), 0f, size * 0.05f, size * 0.08))
            val ps = ParagraphStyle().apply {
                textStyle = st
                direction = if (text.any { it in '؀'..'ۿ' }) Direction.RTL else Direction.LTR
                alignment = when (d.prop("align", "center")) { "start" -> Alignment.START; "end" -> Alignment.END; else -> Alignment.CENTER }
            }
            para = ParagraphBuilder(ps, Fonts.collection).pushStyle(st).addText(text).popStyle().build().apply { layout(w) }
            key = k
        }
        val bg = d.prop("bg")
        if (bg.isNotBlank()) Paint().use { p -> p.color = Fonts.color(bg, 0x80000000.toInt()); c.drawRRect(RRect.makeXYWH(0f, 0f, w, h, h * 0.18f), p) }
        val p = para ?: return
        p.paint(c, 0f, ((h - p.height) / 2).coerceAtLeast(0f))
    }
    override fun close() { para?.close() }
}

/** A colour or a two-colour gradient filling the box. */
class ColorSource(private val def: () -> SourceDef?) : DrawnSource {
    override fun stamp(w: Float, h: Float): Any? = def()?.let { listOf(it.props, w, h) }
    override fun draw(c: Canvas, w: Float, h: Float) {
        val d = def() ?: return
        val a = Fonts.color(d.prop("color", "#101820"), 0xFF101820.toInt())
        val b = d.prop("color2").takeIf { it.isNotBlank() }?.let { Fonts.color(it, a) }
        Paint().use { p ->
            if (b != null) p.shader = Shader.makeLinearGradient(0f, 0f, if (d.prop("vertical") == "1") 0f else w, if (d.prop("vertical") == "1") h else 0f, intArrayOf(a, b))
            else p.color = a
            c.drawRect(Rect.makeWH(w, h), p)
        }
    }
}
