package com.vil3ntec.rawrec.desktop

import org.bytedeco.ffmpeg.avcodec.AVCodecContext
import org.bytedeco.ffmpeg.avcodec.AVPacket
import org.bytedeco.ffmpeg.avutil.AVDictionary
import org.bytedeco.ffmpeg.avutil.AVFrame
import org.bytedeco.ffmpeg.global.avcodec.*
import org.bytedeco.ffmpeg.global.avutil.*
import org.bytedeco.ffmpeg.global.swscale.*
import org.bytedeco.ffmpeg.swscale.SwsContext
import org.bytedeco.javacpp.BytePointer
import org.bytedeco.javacpp.DoublePointer
import org.bytedeco.javacpp.IntPointer
import org.bytedeco.javacpp.Pointer
import org.bytedeco.javacpp.PointerPointer

/**
 * BGRA pictures into a video stream on the graphics card's encoder (or the CPU's). The picture is
 * scaled to the chosen size keeping its shape: a picture of another shape (the phone turned) sits in
 * the middle with black around it, never stretched. Time base: milliseconds.
 */
class VideoEncoder(
    val encoder: Encoders.Encoder,
    val width: Int,
    val height: Int,
    val fps: Int,
    val bitrateKbps: Int,
    /** MP4/MKV want the stream's headers once at the start (extradata); a live stream sends them in front of key frames. */
    globalHeader: Boolean,
    /** For a recording: the best quality the encoder can give at this rate (look-ahead, adaptive quantisation). */
    val quality: Boolean = true,
) : AutoCloseable {

    val ctx: AVCodecContext
    private val frame: AVFrame
    private val pkt: AVPacket = av_packet_alloc()
    private var sws: SwsContext? = null
    private var lastSrcW = 0
    private var lastSrcH = 0
    @Volatile var frames = 0L; private set

    init {
        require(width % 2 == 0 && height % 2 == 0) { "even size needed: ${width}x$height" }
        val c = avcodec_find_encoder_by_name(encoder.name) ?: throw IllegalStateException("no encoder ${encoder.name}")
        ctx = avcodec_alloc_context3(c)
        ctx.width(width); ctx.height(height)
        ctx.time_base(av_make_q(1, 1000)); ctx.framerate(av_make_q(fps, 1))
        ctx.pix_fmt(pixFmtFor(encoder.name))
        ctx.bit_rate(bitrateKbps * 1000L)
        ctx.rc_max_rate(bitrateKbps * 1500L)
        ctx.rc_buffer_size(bitrateKbps * 2000)
        ctx.gop_size(fps * 2)
        ctx.max_b_frames(0)
        // standard video colours, said in the stream so players do not guess (washed out / too dark)
        ctx.color_range(AVCOL_RANGE_MPEG); ctx.colorspace(AVCOL_SPC_BT709); ctx.color_primaries(AVCOL_PRI_BT709); ctx.color_trc(AVCOL_TRC_BT709)
        if (globalHeader) ctx.flags(ctx.flags() or AV_CODEC_FLAG_GLOBAL_HEADER)
        val opts = AVDictionary(null as Pointer?)
        for ((k, v) in options(encoder.name, quality)) av_dict_set(opts, k, v, 0)
        val r = avcodec_open2(ctx, c, opts)
        av_dict_free(opts)
        check(r >= 0) { "encoder ${encoder.name}: ${VideoDecoder.err(r)}" }
        frame = av_frame_alloc()
        frame.format(ctx.pix_fmt()); frame.width(width); frame.height(height)
        check(av_frame_get_buffer(frame, 32) >= 0) { "frame buffer" }
    }

    /** One picture at [ptsMs]; every packet the encoder gives back goes to [out] (valid only during the call). */
    fun encode(src: VideoFrame, ptsMs: Long, out: (AVPacket) -> Unit) {
        check(av_frame_make_writable(frame) >= 0) { "frame not writable" }
        place(src)
        frame.pts(ptsMs)
        send(frame, out)
        frames++
    }

    fun flush(out: (AVPacket) -> Unit) = send(null, out)

    private fun send(f: AVFrame?, out: (AVPacket) -> Unit) {
        val r = avcodec_send_frame(ctx, f)
        if (r < 0 && r != AVERROR_EOF()) throw IllegalStateException("encode: ${VideoDecoder.err(r)}")
        while (true) {
            val g = avcodec_receive_packet(ctx, pkt)
            if (g == AVERROR_EAGAIN() || g == AVERROR_EOF()) break
            if (g < 0) throw IllegalStateException("encode: ${VideoDecoder.err(g)}")
            try { out(pkt) } finally { av_packet_unref(pkt) }
        }
    }

    /** The picture scaled into the frame keeping its shape, centred; black around it when the shapes differ. */
    private fun place(src: VideoFrame) {
        val scale = minOf(width.toDouble() / src.width, height.toDouble() / src.height)
        val fw = ((src.width * scale).toInt() and 1.inv()).coerceIn(2, width)
        val fh = ((src.height * scale).toInt() and 1.inv()).coerceIn(2, height)
        val ox = ((width - fw) / 2) and 1.inv()
        val oy = ((height - fh) / 2) and 1.inv()
        if (fw != width || fh != height) blacken()
        sws = sws_getCachedContext(sws, src.width, src.height, AV_PIX_FMT_BGRA, fw, fh, ctx.pix_fmt(), SWS_BICUBIC, null, null, null as DoublePointer?)
        if (src.width != lastSrcW || src.height != lastSrcH) {
            lastSrcW = src.width; lastSrcH = src.height
            // RGB → BT.709 limited range, as said in the stream
            val coefs = sws_getCoefficients(SWS_CS_ITU709)
            sws_setColorspaceDetails(sws, coefs, 1, coefs, 0, 0, 1 shl 16, 1 shl 16)
        }
        val srcData = PointerPointer<BytePointer>(4L).put(0L, BytePointer(src.bgra))
        val srcLs = IntPointer(4L).put(0L, src.width * 4)
        val dst = PointerPointer<BytePointer>(4L)
        val dstLs = IntPointer(4L)
        val planes = if (ctx.pix_fmt() == AV_PIX_FMT_NV12) 2 else 3
        for (p in 0 until planes) {
            val ls = frame.linesize(p)
            val (px, py) = if (p == 0) ox to oy else (if (planes == 2) ox else ox / 2) to oy / 2
            dst.put(p.toLong(), BytePointer(frame.data(p)).position(py.toLong() * ls + px))
            dstLs.put(p.toLong(), ls)
        }
        sws_scale(sws, srcData, srcLs, 0, src.height, dst, dstLs)
        srcData.close(); srcLs.close(); dst.close(); dstLs.close()
    }

    /** Video black: Y 16, chroma 128 (limited range). */
    private fun blacken() {
        val planes = if (ctx.pix_fmt() == AV_PIX_FMT_NV12) 2 else 3
        for (p in 0 until planes) {
            val rows = if (p == 0) height else height / 2
            Pointer.memset(frame.data(p), if (p == 0) 16 else 128, frame.linesize(p).toLong() * rows)
        }
    }

    override fun close() {
        sws?.let { sws_freeContext(it) }; sws = null
        val f = frame
        av_frame_free(f)
        av_packet_free(pkt)
        avcodec_free_context(ctx)
    }

    companion object {
        /** NV12 for every graphics card's encoder; planar 4:2:0 for the software ones. */
        fun pixFmtFor(name: String) = if (name.startsWith("lib")) AV_PIX_FMT_YUV420P else AV_PIX_FMT_NV12

        /** Each vendor's own words for «best quality at this rate». */
        fun options(name: String, quality: Boolean): List<Pair<String, String>> = when {
            name.endsWith("_nvenc") -> listOf("preset" to (if (quality) "p6" else "p4"), "tune" to (if (quality) "hq" else "ll"), "rc" to (if (quality) "vbr" else "cbr")) +
                (if (quality) listOf("spatial-aq" to "1", "temporal-aq" to "1", "rc-lookahead" to "20") else listOf("zerolatency" to "1"))
            name.endsWith("_amf") -> listOf("quality" to (if (quality) "quality" else "speed"), "rc" to (if (quality) "vbr_peak" else "cbr"))
            name.endsWith("_qsv") -> listOf("preset" to (if (quality) "slower" else "veryfast"))
            name.endsWith("_videotoolbox") -> listOf("realtime" to (if (quality) "0" else "1"), "allow_sw" to "0")
            name.endsWith("_mf") -> listOf("hw_encoding" to "1", "rate_control" to (if (quality) "quality" else "cbr"))
            name == "libx264" -> listOf("preset" to (if (quality) "medium" else "veryfast"))
            name == "libopenh264" -> listOf("allow_skip_frames" to "0", "rc_mode" to "bitrate")
            name == "libsvtav1" -> listOf("preset" to (if (quality) "8" else "10"))
            else -> emptyList()
        }
    }
}
