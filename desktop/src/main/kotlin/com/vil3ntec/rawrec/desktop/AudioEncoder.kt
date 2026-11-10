package com.vil3ntec.rawrec.desktop

import org.bytedeco.ffmpeg.avcodec.AVCodecContext
import org.bytedeco.ffmpeg.avcodec.AVPacket
import org.bytedeco.ffmpeg.avutil.AVDictionary
import org.bytedeco.ffmpeg.avutil.AVFrame
import org.bytedeco.ffmpeg.global.avcodec.*
import org.bytedeco.ffmpeg.global.avutil.*
import org.bytedeco.javacpp.FloatPointer

/**
 * The phone's sound (16-bit PCM, 48 kHz, stereo) into AAC. Time base: samples (1/48000). The sound is
 * counted, not stamped: a recording never drifts against the picture; a gap the phone leaves (a silent
 * game sends nothing) is filled with silence so the picture and sound stay together.
 */
class AudioEncoder(bitrateKbps: Int = 192) : AutoCloseable {
    val ctx: AVCodecContext
    private val frame: AVFrame
    private val pkt: AVPacket = av_packet_alloc()
    private val frameSize: Int
    private val left: FloatArray
    private val right: FloatArray
    private var filled = 0
    /** The next sample's position (in samples from the start of the recording). */
    var position = 0L; private set

    init {
        val c = avcodec_find_encoder_by_name("aac") ?: throw IllegalStateException("no AAC encoder")
        ctx = avcodec_alloc_context3(c)
        ctx.sample_fmt(AV_SAMPLE_FMT_FLTP)
        ctx.sample_rate(RATE)
        av_channel_layout_default(ctx.ch_layout(), 2)
        ctx.bit_rate(bitrateKbps * 1000L)
        ctx.time_base(av_make_q(1, RATE))
        ctx.flags(ctx.flags() or AV_CODEC_FLAG_GLOBAL_HEADER)
        val r = avcodec_open2(ctx, c, null as AVDictionary?)
        check(r >= 0) { "AAC: ${VideoDecoder.err(r)}" }
        frameSize = ctx.frame_size().takeIf { it > 0 } ?: 1024
        left = FloatArray(frameSize); right = FloatArray(frameSize)
        frame = av_frame_alloc()
        frame.format(AV_SAMPLE_FMT_FLTP); frame.nb_samples(frameSize); frame.sample_rate(RATE)
        av_channel_layout_copy(frame.ch_layout(), ctx.ch_layout())
        check(av_frame_get_buffer(frame, 0) >= 0) { "audio frame" }
    }

    /**
     * Samples for position [atSample] (from the recording's start). Earlier than where the sound is: the
     * overlap is dropped; later: silence fills the gap (up to 2 s at once — beyond, the sound restarts there).
     */
    fun encodePcm(pcm: ByteArray, atSample: Long, out: (AVPacket) -> Unit) {
        val n = pcm.size / 4
        var skip = 0
        val gap = atSample - position
        if (gap in 1..RATE * 2L) repeat(gap.toInt()) { push(0f, 0f, out) }
        else if (gap > RATE * 2L) position = atSample
        else if (gap < 0) skip = (-gap).toInt().coerceAtMost(n)
        for (i in skip until n) {
            val l = ((pcm[i * 4].toInt() and 0xFF) or (pcm[i * 4 + 1].toInt() shl 8)).toShort() / 32768f
            val r = ((pcm[i * 4 + 2].toInt() and 0xFF) or (pcm[i * 4 + 3].toInt() shl 8)).toShort() / 32768f
            push(l, r, out)
        }
    }

    private fun push(l: Float, r: Float, out: (AVPacket) -> Unit) {
        left[filled] = l; right[filled] = r; filled++
        if (filled == frameSize) {
            check(av_frame_make_writable(frame) >= 0)
            FloatPointer(frame.data(0)).put(left, 0, frameSize)
            FloatPointer(frame.data(1)).put(right, 0, frameSize)
            frame.pts(position - frameSize + 1)
            send(frame, out)
            filled = 0
        }
        position++
    }

    fun flush(out: (AVPacket) -> Unit) = send(null, out)

    private fun send(f: AVFrame?, out: (AVPacket) -> Unit) {
        val r = avcodec_send_frame(ctx, f)
        if (r < 0 && r != AVERROR_EOF()) throw IllegalStateException("AAC: ${VideoDecoder.err(r)}")
        while (true) {
            val g = avcodec_receive_packet(ctx, pkt)
            if (g == AVERROR_EAGAIN() || g == AVERROR_EOF()) break
            if (g < 0) throw IllegalStateException("AAC: ${VideoDecoder.err(g)}")
            try { out(pkt) } finally { av_packet_unref(pkt) }
        }
    }

    override fun close() {
        av_frame_free(frame); av_packet_free(pkt); avcodec_free_context(ctx)
    }

    companion object { const val RATE = 48_000 }
}
