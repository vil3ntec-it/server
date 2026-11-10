package com.vil3ntec.rawrec.desktop.studio

import android.media.MediaCodec
import android.media.MediaFormat
import com.vil3ntec.rawrec.LiveSettings
import com.vil3ntec.rawrec.Mp4Writer
import com.vil3ntec.rawrec.MultiSink
import com.vil3ntec.rawrec.RtmpSink
import com.vil3ntec.rawrec.desktop.AudioEncoder
import com.vil3ntec.rawrec.desktop.Encoders
import com.vil3ntec.rawrec.desktop.VideoEncoder
import com.vil3ntec.rawrec.desktop.VideoFrame
import org.bytedeco.ffmpeg.avcodec.AVPacket
import org.bytedeco.ffmpeg.global.avcodec.AV_PKT_FLAG_KEY
import java.nio.ByteBuffer
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * The studio's picture live on every chosen platform at once: encoded once (graphics card first, in its
 * low-delay mode), then the phone app's own live core — [MultiSink] of [RtmpSink]s — sends it, with its
 * automatic quality (the rate follows what the slowest platform's link really carries, measured only when
 * frames wait), reconnects, and real-time-first rule. The encoder is asked for a key frame whenever a
 * platform (re)starts, and for a new rate when the link changes.
 */
class LiveOutput(
    private val encoder: Encoders.Encoder,
    private val width: Int, private val height: Int, private val fps: Int,
    private val maxKbps: Int,
    dests: List<LiveSettings.Dest>,
    private val statusCb: (RtmpSink.Status) -> Unit,
) : Output {
    private val sink: MultiSink
    private val free = ArrayBlockingQueue<ByteBuffer>(POOL)
    private val queue = ArrayBlockingQueue<Item>(POOL + 128)
    private class Item(val buf: ByteBuffer?, val ptsUs: Long, val pcm: ByteArray?)
    @Volatile private var running = true
    @Volatile var dropped = 0L; private set
    @Volatile var error: String? = null; private set
    @Volatile private var wantKbps = maxKbps
    @Volatile private var wantKey = true
    private var allocated = 0
    @Volatile private var firstVideoUs = Long.MIN_VALUE
    val perDest: List<MultiSink.Dest> get() = sink.dests

    init {
        sink = MultiSink(dests, maxKbps * 1000, object : RtmpSink.Listener {
            override fun onStatus(s: RtmpSink.Status) = statusCb(s)
            override fun onBitrate(bps: Int) { wantKbps = (bps / 1000).coerceIn(250, maxKbps) }
        })
    }

    private val thread = Thread({ loop() }, "studio-live").apply { priority = Thread.MAX_PRIORITY - 1; start() }

    override fun video(f: VideoFrame) {
        if (!running) return
        if (firstVideoUs == Long.MIN_VALUE) firstVideoUs = f.ptsUs
        val need = f.width * f.height * 4
        var b = free.poll()
        if (b == null || b.capacity() < need) {
            if (b == null && allocated >= POOL) { dropped++; return }
            if (b == null) allocated++
            b = ByteBuffer.allocateDirect(need)
        }
        b!!.clear()
        val src = f.bgra.duplicate(); src.clear(); src.limit(need)
        b.put(src); b.flip()
        if (!queue.offer(Item(b, f.ptsUs, null))) { free.offer(b); dropped++ }
    }

    override fun audio(pcm: ByteArray, ptsUs: Long) {
        if (!running || firstVideoUs == Long.MIN_VALUE || ptsUs < firstVideoUs) return
        queue.offer(Item(null, ptsUs, pcm.copyOf()))
    }

    private fun loop() {
        var venc: VideoEncoder? = null
        var kbps = maxKbps
        val aenc = AudioEncoder(160)
        var sentFormat = false
        try {
            sink.audioFormat(MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, AudioEncoder.RATE, 2).apply {
                val ed = aenc.ctx.extradata(); val n = aenc.ctx.extradata_size()
                val asc = ByteArray(n); ed.get(asc)
                setByteBuffer("csd-0", ByteBuffer.wrap(asc))
            })
            while (running || queue.isNotEmpty()) {
                val it = queue.poll(100, TimeUnit.MILLISECONDS) ?: continue
                if (it.pcm != null) {
                    aenc.encodePcm(it.pcm, (it.ptsUs - firstVideoUs) * AudioEncoder.RATE / 1_000_000) { p -> sendAudio(p) }
                    continue
                }
                try {
                    // a new rate: the encoders that can change on the fly do; the others start again (a key frame)
                    val want = wantKbps
                    if (venc == null || (want != kbps && (kotlin.math.abs(want - kbps) * 10 > kbps))) {
                        if (venc != null && liveRate(encoder.name)) { venc.setBitrate(want); kbps = want }
                        else {
                            venc?.close()
                            kbps = want
                            venc = VideoEncoder(encoder, width, height, fps, kbps, globalHeader = false, quality = false)
                            wantKey = true
                            if (sentFormat) sink.encoderReplaced()
                        }
                    }
                    val key = wantKey; wantKey = false
                    venc!!.encode(VideoFrame(width, height, it.buf!!, it.ptsUs), (it.ptsUs - firstVideoUs) / 1000, key) { p ->
                        val data = ByteArray(p.size()); p.data().get(data)
                        val isKey = p.flags() and AV_PKT_FLAG_KEY != 0
                        if (isKey) formatFrom(data)?.let { mf -> sink.videoFormat(mf); sentFormat = true }
                        if (sentFormat) {
                            val pts = (p.pts() * 1000) + firstVideoUs
                            if (sink.submitVideo(ByteBuffer.wrap(data), 0, data.size, pts, if (isKey) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)) wantKey = true
                        }
                    }
                } finally { free.offer(it.buf!!) }
            }
        } catch (t: Throwable) {
            error = t.message ?: t.javaClass.simpleName
            running = false
        } finally {
            try { venc?.close() } catch (_: Throwable) {}
            try { aenc.close() } catch (_: Throwable) {}
        }
    }

    private fun sendAudio(p: AVPacket) {
        val data = ByteArray(p.size()); p.data().get(data)
        val pts = p.pts() * 1_000_000L / AudioEncoder.RATE + firstVideoUs
        sink.submitAudio(ByteBuffer.wrap(data), 0, data.size, pts, 0)
    }

    private var lastSps: ByteArray? = null
    private var lastPps: ByteArray? = null

    /** The picture's parameter sets, as Android's encoder gives them (csd-0 / csd-1), when they are new. */
    private fun formatFrom(annexB: ByteArray): MediaFormat? {
        val nals = Mp4Writer.nals(annexB)
        val sps = nals.firstOrNull { (it[0].toInt() and 0x1F) == 7 } ?: return null
        val pps = nals.firstOrNull { (it[0].toInt() and 0x1F) == 8 } ?: return null
        if (sps.contentEquals(lastSps) && pps.contentEquals(lastPps)) return null
        lastSps = sps; lastPps = pps
        val sc = byteArrayOf(0, 0, 0, 1)
        return MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_AVC, width, height).apply {
            setInteger(MediaFormat.KEY_FRAME_RATE, fps)
            setByteBuffer("csd-0", ByteBuffer.wrap(sc + sps))
            setByteBuffer("csd-1", ByteBuffer.wrap(sc + pps))
        }
    }

    /** Ends the stream: what waits is sent, every platform told goodbye. */
    fun stop() {
        running = false
        thread.join(5000)
        sink.finish()
    }

    companion object {
        private const val POOL = 4
        /** Encoders that take a new bit rate without starting again (FFmpeg reconfigures them between pictures). */
        fun liveRate(name: String) = name.endsWith("_nvenc") || name == "libx264"
    }
}
