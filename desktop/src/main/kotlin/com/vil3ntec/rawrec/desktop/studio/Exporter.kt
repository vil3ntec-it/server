package com.vil3ntec.rawrec.desktop.studio

import com.vil3ntec.rawrec.desktop.*
import org.bytedeco.ffmpeg.avcodec.AVCodecContext
import org.bytedeco.ffmpeg.avfilter.AVFilterContext
import org.bytedeco.ffmpeg.avfilter.AVFilterGraph
import org.bytedeco.ffmpeg.avformat.AVFormatContext
import org.bytedeco.ffmpeg.avutil.AVChannelLayout
import org.bytedeco.ffmpeg.avutil.AVDictionary
import org.bytedeco.ffmpeg.avutil.AVFrame
import org.bytedeco.ffmpeg.global.avcodec.*
import org.bytedeco.ffmpeg.global.avfilter.*
import org.bytedeco.ffmpeg.global.avformat.*
import org.bytedeco.ffmpeg.global.avutil.*
import org.bytedeco.ffmpeg.global.swresample.*
import org.bytedeco.ffmpeg.global.swscale.*
import org.bytedeco.ffmpeg.swresample.SwrContext
import org.bytedeco.javacpp.BytePointer
import org.bytedeco.javacpp.DoublePointer
import org.bytedeco.javacpp.IntPointer
import org.bytedeco.javacpp.Pointer
import org.bytedeco.javacpp.PointerPointer
import org.jetbrains.skia.ColorAlphaType
import org.jetbrains.skia.ColorType
import org.jetbrains.skia.Image
import org.jetbrains.skia.ImageInfo
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date

/** A piece of a recording: from [inMs] to [outMs] (outMs ≤ 0 = to the end). */
data class Clip(val file: File, val inMs: Long = 0, val outMs: Long = 0)

/**
 * How the finished video is made. [enhance]: the «studio» treatment for game footage — blocks the phone's
 * encoder left smoothed (deblock), brought to the chosen size with Lanczos, then contrast-adaptive
 * sharpening (CAS, as AMD FidelityFX) at [sharpen] (0..1). Not an AI upscaler: honest, fast, no
 * invented detail, and it looks clearly crisper — above all when uploaded at 1440p/4K.
 */
data class ExportOptions(val height: Int = 0, val enhance: Boolean = true, val sharpen: Float = 0.9f, val encoder: String = "", val kbps: Int = 0, val fps: Int = 0)

/** What a video file is: size, rate, length. */
data class MediaInfo(val width: Int, val height: Int, val fps: Double, val durationMs: Long, val hasAudio: Boolean)

object Media {
    fun info(f: File): MediaInfo? {
        val ic = AVFormatContext(null as Pointer?)
        if (avformat_open_input(ic, f.absolutePath, null, null) < 0) return null
        try {
            avformat_find_stream_info(ic, null as PointerPointer<*>?)
            var w = 0; var h = 0; var fps = 30.0; var audio = false
            for (i in 0 until ic.nb_streams()) {
                val st = ic.streams(i); val p = st.codecpar()
                if (p.codec_type() == AVMEDIA_TYPE_VIDEO && w == 0) { w = p.width(); h = p.height(); val r = st.avg_frame_rate(); if (r.den() > 0 && r.num() > 0) fps = r.num().toDouble() / r.den() }
                if (p.codec_type() == AVMEDIA_TYPE_AUDIO) audio = true
            }
            return MediaInfo(w, h, fps, ic.duration() / 1000, audio)
        } finally { avformat_close_input(ic) }
    }

    /** One picture at [ms], [maxW] wide at most, through the same treatment as the export when [opt] says so. */
    fun frameAt(f: File, ms: Long, maxW: Int, opt: ExportOptions? = null): Image? {
        val r = Reader(f) ?: return null
        try {
            r.seek(ms)
            var img: Image? = null
            val target = opt?.let { o -> outSize(r.width, r.height, o.height) } ?: (r.width to r.height)
            val graph = opt?.let { Filters(r.width, r.height, r.pixFmt, r.vtb, filterDesc(target.first, target.second, it)) }
            try {
                while (img == null) {
                    val fr = r.nextVideo() ?: break
                    val ts = r.ms(fr)
                    if (ts < ms - 1) { av_frame_unref(fr); continue }
                    val use: (AVFrame) -> Unit = { x -> img = toImage(x, maxW) }
                    if (graph != null) graph.push(fr, use) else use(fr)
                    av_frame_unref(fr)
                }
            } finally { graph?.close() }
            return img
        } finally { r.close() }
    }

    fun outSize(w: Int, h: Int, height: Int): Pair<Int, Int> {
        if (height <= 0 || height == h) return (w and 1.inv()) to (h and 1.inv())
        val ow = ((w.toLong() * height / h).toInt() + 1) and 1.inv()
        return ow to (height and 1.inv())
    }

    fun filterDesc(w: Int, h: Int, o: ExportOptions): String {
        val parts = ArrayList<String>()
        // measured on blocky game footage against a plain bicubic enlargement to 1440p (ffmpeg blockdetect / blurdetect,
        // lower is better): blocks 2.42 → 2.17, blur 8.77 → 7.95 at CAS 0.9. Only LGPL filters (the app's FFmpeg has no
        // GPL ones such as hqdn3d). CAS at 1.0 makes ringing: kept below it.
        if (o.enhance) { parts.add("fftdnoiz=sigma=3"); parts.add("deblock=filter=strong:block=8") }
        parts.add("scale=$w:$h:flags=lanczos+accurate_rnd+full_chroma_int")
        if (o.enhance && o.sharpen > 0f) parts.add("cas=strength=${"%.2f".format(java.util.Locale.US, o.sharpen.coerceIn(0f, 0.95f))}")
        parts.add("format=yuv420p")
        return parts.joinToString(",")
    }

    internal fun toImage(f: AVFrame, maxW: Int): Image {
        val w = minOf(maxW, f.width()) and 1.inv(); val h = ((f.height().toLong() * w / f.width()).toInt()) and 1.inv()
        val sws = sws_getContext(f.width(), f.height(), f.format(), w, h, AV_PIX_FMT_BGRA, SWS_AREA or SWS_ACCURATE_RND, null, null, null as DoublePointer?)
        val buf = BytePointer(w.toLong() * h * 4)
        val dp = PointerPointer<BytePointer>(4L).put(0L, buf); val dl = IntPointer(4L).put(0L, w * 4)
        sws_scale(sws, f.data(), f.linesize(), 0, f.height(), dp, dl)
        sws_freeContext(sws)
        val bytes = ByteArray(w * h * 4); buf.get(bytes); buf.close(); dp.close(); dl.close()
        return Image.makeRaster(ImageInfo(w, h, ColorType.BGRA_8888, ColorAlphaType.OPAQUE), bytes, w * 4)
    }
}

/** Reads a file's pictures and sound in order, decoded. */
internal class Reader private constructor(private val ic: AVFormatContext) : AutoCloseable {
    var vi = -1; var ai = -1
    lateinit var vdec: AVCodecContext
    var adec: AVCodecContext? = null
    private val pkt = av_packet_alloc()
    private val vf = av_frame_alloc()
    private val af = av_frame_alloc()
    private val pendingAudio = ArrayDeque<AVFrame>()
    val width get() = vdec.width()
    val height get() = vdec.height()
    val pixFmt get() = vdec.pix_fmt()
    val vtb get() = ic.streams(vi).time_base()
    val atb get() = ic.streams(ai).time_base()
    private var eof = false

    fun ms(f: AVFrame, audio: Boolean = false): Long {
        val tb = if (audio) atb else vtb
        val p = f.best_effort_timestamp().takeIf { it != AV_NOPTS_VALUE } ?: f.pts()
        val start = ic.start_time().takeIf { it != AV_NOPTS_VALUE } ?: 0
        return av_rescale_q(p, tb, av_make_q(1, 1000)) - start / 1000
    }

    fun seek(ms: Long) {
        val start = ic.start_time().takeIf { it != AV_NOPTS_VALUE } ?: 0
        av_seek_frame(ic, -1, start + ms * 1000, AVSEEK_FLAG_BACKWARD)
        avcodec_flush_buffers(vdec); adec?.let { avcodec_flush_buffers(it) }
        while (pendingAudio.isNotEmpty()) av_frame_free(pendingAudio.removeFirst())
        eof = false
    }

    /** The next picture (valid until the next call; unref it), with any sound before it queued for [nextAudio]. */
    fun nextVideo(): AVFrame? {
        while (true) {
            if (avcodec_receive_frame(vdec, vf) == 0) return vf
            if (eof) return null
            if (av_read_frame(ic, pkt) < 0) { eof = true; avcodec_send_packet(vdec, null); continue }
            if (pkt.stream_index() == vi) avcodec_send_packet(vdec, pkt)
            else if (pkt.stream_index() == ai) adec?.let { d ->
                if (avcodec_send_packet(d, pkt) >= 0) while (avcodec_receive_frame(d, af) == 0) { pendingAudio.addLast(av_frame_clone(af)); av_frame_unref(af) }
            }
            av_packet_unref(pkt)
        }
    }

    fun nextAudio(): AVFrame? = pendingAudio.removeFirstOrNull()

    override fun close() {
        while (pendingAudio.isNotEmpty()) av_frame_free(pendingAudio.removeFirst())
        av_frame_free(vf); av_frame_free(af); av_packet_free(pkt)
        avcodec_free_context(vdec); adec?.let { avcodec_free_context(it) }
        avformat_close_input(ic)
    }

    companion object {
        operator fun invoke(f: File): Reader? {
            val ic = AVFormatContext(null as Pointer?)
            if (avformat_open_input(ic, f.absolutePath, null, null) < 0) return null
            avformat_find_stream_info(ic, null as PointerPointer<*>?)
            val r = Reader(ic)
            r.vi = av_find_best_stream(ic, AVMEDIA_TYPE_VIDEO, -1, -1, null as org.bytedeco.ffmpeg.avcodec.AVCodec?, 0)
            if (r.vi < 0) { avformat_close_input(ic); return null }
            r.vdec = open(ic, r.vi)
            r.ai = av_find_best_stream(ic, AVMEDIA_TYPE_AUDIO, -1, r.vi, null as org.bytedeco.ffmpeg.avcodec.AVCodec?, 0)
            if (r.ai >= 0) r.adec = open(ic, r.ai)
            return r
        }
        private fun open(ic: AVFormatContext, i: Int): AVCodecContext {
            val p = ic.streams(i).codecpar()
            val c = avcodec_find_decoder(p.codec_id())
            val d = avcodec_alloc_context3(c)
            avcodec_parameters_to_context(d, p)
            d.thread_count(0)
            check(avcodec_open2(d, c, null as AVDictionary?) >= 0) { "cannot decode" }
            d.pkt_timebase(ic.streams(i).time_base())
            return d
        }
    }
}

/** An FFmpeg filter chain (deblock, scale, CAS…) for pictures of one size and format. */
internal class Filters(w: Int, h: Int, fmt: Int, tb: org.bytedeco.ffmpeg.avutil.AVRational, desc: String) : AutoCloseable {
    private val graph: AVFilterGraph = avfilter_graph_alloc()
    private val src = AVFilterContext(null as Pointer?)
    private val sink = AVFilterContext(null as Pointer?)
    private val out = av_frame_alloc()

    init {
        val args = "video_size=${w}x$h:pix_fmt=$fmt:time_base=${tb.num()}/${tb.den()}:pixel_aspect=1/1"
        check(avfilter_graph_create_filter(src, avfilter_get_by_name("buffer"), "in", args, null, graph) >= 0) { "filter in" }
        check(avfilter_graph_create_filter(sink, avfilter_get_by_name("buffersink"), "out", null as String?, null, graph) >= 0) { "filter out" }
        val outs = avfilter_inout_alloc(); outs.name(av_strdup(BytePointer("in"))); outs.filter_ctx(src); outs.pad_idx(0); outs.next(null)
        val ins = avfilter_inout_alloc(); ins.name(av_strdup(BytePointer("out"))); ins.filter_ctx(sink); ins.pad_idx(0); ins.next(null)
        val r = avfilter_graph_parse_ptr(graph, desc, ins, outs, null)
        avfilter_inout_free(ins); avfilter_inout_free(outs)
        check(r >= 0) { "filters «$desc»: ${VideoDecoder.err(r)}" }
        val c = avfilter_graph_config(graph, null)
        check(c >= 0) { "filters: ${VideoDecoder.err(c)}" }
    }

    fun push(f: AVFrame?, use: (AVFrame) -> Unit) {
        check(av_buffersrc_add_frame_flags(src, f, AV_BUFFERSRC_FLAG_KEEP_REF) >= 0) { "filter push" }
        while (av_buffersink_get_frame(sink, out) >= 0) { try { use(out) } finally { av_frame_unref(out) } }
    }

    override fun close() { av_frame_free(out); avfilter_graph_free(graph) }
}

/**
 * Joins the clips (each cut to its in/out) into one new MP4: pictures through the chosen treatment,
 * encoded with the graphics card's encoder (quality mode), sound re-encoded to AAC; one continuous timeline.
 * Never touches the originals.
 */
class Exporter(private val clips: List<Clip>, private val opt: ExportOptions, private val dir: File = AppPaths.videos) {
    @Volatile var progress = 0f; private set
    @Volatile var error: String? = null; private set
    @Volatile var done: File? = null; private set
    @Volatile private var cancelled = false
    fun cancel() { cancelled = true }

    fun run(): File? {
        try {
            val infos = clips.map { Media.info(it.file) ?: throw IllegalStateException("${it.file.name} باز نشد") }
            val first = infos.first()
            val (w, h) = Media.outSize(first.width, first.height, opt.height)
            val fps = if (opt.fps > 0) opt.fps else Math.round(first.fps).toInt().coerceIn(10, 120)
            val enc = Encoders.available().firstOrNull { it.name == opt.encoder } ?: Encoders.best() ?: throw IllegalStateException("هیچ انکودری کار نمی‌کند")
            val kbps = if (opt.kbps > 0) opt.kbps else when { h >= 2160 -> 60000; h >= 1440 -> 30000; else -> 16000 } * (if (fps >= 50) 3 else 2) / 2
            val total = clips.zip(infos).sumOf { (c, i) -> (if (c.outMs > 0) c.outMs else i.durationMs) - c.inMs }.coerceAtLeast(1)
            val mkv = File(dir, "RawRec Edit ${SimpleDateFormat("yyyy-MM-dd HH-mm-ss").format(Date())}.mkv")
            val venc = VideoEncoder(enc, w, h, fps, kbps, globalHeader = true, quality = true)
            val aenc = AudioEncoder(256)
            val writer = FileWriter(mkv, venc.ctx, aenc.ctx)
            var baseMs = 0L                     // where the current clip starts on the new timeline
            var lastV = -1L
            try {
                for ((c, info) in clips.zip(infos)) {
                    if (cancelled) break
                    val r = Reader(c.file) ?: continue
                    val endMs = if (c.outMs > 0) c.outMs else info.durationMs
                    val graph = Filters(r.width, r.height, r.pixFmt, r.vtb, Media.filterDesc(w, h, opt))
                    val swr = r.adec?.let { audioConverter(it) }
                    try {
                        r.seek(c.inMs)
                        var sws: org.bytedeco.ffmpeg.swscale.SwsContext? = null
                        while (!cancelled) {
                            val fr = r.nextVideo() ?: break
                            val t = r.ms(fr)
                            // the sound that came before this picture
                            while (true) {
                                val a = r.nextAudio() ?: break
                                val at = r.ms(a, audio = true)
                                if (at >= c.inMs && at < endMs && swr != null) {
                                    val pcm = toPcm(swr, a)
                                    aenc.encodePcm(pcm, (baseMs + at - c.inMs) * AudioEncoder.RATE / 1000) { p -> writer.writeAudio(p) }
                                }
                                av_frame_free(a)
                            }
                            if (t < c.inMs) { av_frame_unref(fr); continue }
                            if (t >= endMs) { av_frame_unref(fr); break }
                            val outMs = baseMs + t - c.inMs
                            graph.push(fr) { g ->
                                var ms = outMs
                                if (ms <= lastV) ms = lastV + 1
                                lastV = ms
                                sws = venc.encodeFrame(g, ms, sws) { p -> writer.writeVideo(p) }
                            }
                            av_frame_unref(fr)
                            progress = ((outMs).toFloat() / total).coerceIn(0f, 1f)
                        }
                        sws?.let { sws_freeContext(it) }
                    } finally { graph.close(); swr?.let { swr_free(it) }; r.close() }
                    baseMs += endMs - c.inMs
                }
                venc.flush { p -> writer.writeVideo(p) }
                aenc.flush { p -> writer.writeAudio(p) }
            } finally { writer.close(); venc.close(); aenc.close() }
            if (cancelled) { mkv.delete(); error = "لغو شد"; return null }
            val mp4 = File(mkv.parentFile, mkv.nameWithoutExtension + ".mp4")
            val out = if (FileWriter.remux(mkv, mp4)) { mkv.delete(); mp4 } else mkv
            progress = 1f; done = out
            return out
        } catch (t: Throwable) { error = t.message ?: t.javaClass.simpleName; return null }
    }

    private fun audioConverter(d: AVCodecContext): SwrContext {
        val out = AVChannelLayout(); av_channel_layout_default(out, 2)
        // a fresh context (the pointer must start as null: swr_alloc_set_opts2 reuses whatever it points to)
        val c = SwrContext(null as Pointer?)
        check(swr_alloc_set_opts2(c, out, AV_SAMPLE_FMT_S16, AudioEncoder.RATE, d.ch_layout(), d.sample_fmt(), d.sample_rate(), 0, null) >= 0) { "sound converter" }
        check(swr_init(c) >= 0)
        return c
    }

    private fun toPcm(swr: SwrContext, a: AVFrame): ByteArray {
        val max = swr_get_out_samples(swr, a.nb_samples()).coerceAtLeast(a.nb_samples() * 2 + 64)
        val buf = BytePointer(max.toLong() * 4)
        val outp = PointerPointer<BytePointer>(1L).put(0L, buf)
        val n = swr_convert(swr, outp, max, a.extended_data(), a.nb_samples())
        val bytes = ByteArray(maxOf(0, n) * 4); if (n > 0) buf.get(bytes)
        buf.close(); outp.close()
        return bytes
    }
}
