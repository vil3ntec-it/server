package com.vil3ntec.rawrec

import android.media.MediaCodec
import android.media.MediaFormat
import android.os.Process
import java.io.IOException
import java.nio.ByteBuffer
import java.util.concurrent.LinkedBlockingDeque
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * What the recorder writes into while live (instead of an MP4 file): the encoded frames go to the
 * platform over RTMP/RTMPS ([RtmpPublisher]).
 *
 * - **Automatic quality:** when the internet can't keep up (frames waiting more than a second) the
 *   video bit rate goes down at once; when it keeps up again for a while it goes back up to the
 *   chosen quality. Frames that are too late are dropped (a live stream must stay live, not lag).
 * - **Reconnect:** a dropped connection is tried again (1, 2, 4 … 15 s) for up to 3 minutes; the
 *   stream continues from the next key frame.
 */
class RtmpSink(
    private val url: String,
    private val key: String,
    private val maxBitrate: Int,
    private val listener: Listener,
) : MediaSink {

    enum class State { CONNECTING, LIVE, RECONNECTING, FAILED, ENDED }

    class Status(val state: State, val kbps: Int, val targetKbps: Int, val dropped: Int, val reconnects: Int, val error: String?)

    interface Listener {
        fun onStatus(s: Status)
        /** Ask the video encoder for this bit rate (automatic quality). */
        fun onBitrate(bps: Int)
    }

    private class Pkt(val video: Boolean, val pts: Long, val key: Boolean, val data: ByteArray)

    private val queue = LinkedBlockingDeque<Pkt>()
    private val keyWanted = AtomicBoolean(true)
    @Volatile private var stopped = false
    @Volatile private var avcConfig: ByteArray? = null
    @Volatile private var configChanged = false
    @Volatile private var asc: ByteArray? = null
    @Volatile private var noAudio = false
    private var width = 0
    private var height = 0
    private var fps = 60
    private var sampleRate = 48_000
    private var channels = 2
    private val thread = Thread({ run() }, "rawrec-rtmp").apply { start() }

    @Volatile var dropped = 0; private set
    @Volatile var reconnects = 0; private set
    @Volatile private var sent = 0L
    private var sentBefore = 0L
    @Volatile private var lastEnqueuedPts = 0L
    @Volatile private var target = maxBitrate
    @Volatile var liveSinceMs = 0L; private set
    /** The longest the stream ran without a break, and how long it was live in total. */
    @Volatile var totalLiveMs = 0L; private set
    @Volatile var lastError: String? = null; private set

    // ------------------------------------------------------------ MediaSink (encoder threads)

    override fun submitVideo(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int): Boolean {
        if (stopped) return false
        val key = flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
        val raw = ByteArray(size)
        src.duplicate().apply { limit(offset + size); position(offset) }.get(raw)
        val nals = Mp4Writer.nals(raw).filter { (it[0].toInt() and 0x1F) !in 7..9 }
        val out = ByteBuffer.allocate(nals.sumOf { it.size + 4 })
        for (n in nals) { out.putInt(n.size); out.put(n) }
        lastEnqueuedPts = ptsUs
        queue.offer(Pkt(true, ptsUs, key, out.array()))
        return keyWanted.getAndSet(false)
    }

    override fun submitAudio(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int) {
        if (stopped || noAudio) return
        val raw = ByteArray(size)
        src.duplicate().apply { limit(offset + size); position(offset) }.get(raw)
        queue.offer(Pkt(false, ptsUs, false, raw))
    }

    override fun videoFormat(f: MediaFormat) {
        val csd = (0..1).mapNotNull { k -> if (f.containsKey("csd-$k")) f.getByteBuffer("csd-$k") else null }
            .map { b -> b.duplicate().let { d -> d.rewind(); ByteArray(d.remaining()).also { d.get(it) } } }
        if (csd.isEmpty()) return
        val box = try { Mp4Writer.avcC(csd) } catch (_: Exception) { return }
        width = f.getInteger(MediaFormat.KEY_WIDTH)
        height = f.getInteger(MediaFormat.KEY_HEIGHT)
        if (f.containsKey(MediaFormat.KEY_FRAME_RATE)) fps = f.getInteger(MediaFormat.KEY_FRAME_RATE)
        val rec = box.copyOfRange(8, box.size)
        if (avcConfig != null && !avcConfig.contentEquals(rec)) configChanged = true
        avcConfig = rec
        keyWanted.set(true)
    }

    override fun audioFormat(f: MediaFormat) {
        val b = if (f.containsKey("csd-0")) f.getByteBuffer("csd-0") else null
        asc = b?.duplicate()?.let { d -> d.rewind(); ByteArray(d.remaining()).also { d.get(it) } }
        if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) sampleRate = f.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) channels = f.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
    }

    override fun newPart(discardCurrent: Boolean) { keyWanted.set(true) }
    override fun encoderReplaced() { keyWanted.set(true) }
    override fun dropAudio() { noAudio = true }

    override fun finish() {
        stopped = true
        thread.interrupt()
        try { thread.join(3_000) } catch (_: InterruptedException) {}
    }

    override fun emergencyFinish(timeoutMs: Long) {
        stopped = true
        thread.interrupt()
        try { thread.join(timeoutMs) } catch (_: InterruptedException) {}
    }

    override fun parts(): List<SegMuxer.Part> = emptyList()
    override val allClosed: Boolean get() = true
    override val totalBytes: Long get() = sent
    override val videoBytes: Long get() = sent
    override val waitNs: Long get() = 0L

    // ------------------------------------------------------------ sender thread

    private var pub: RtmpPublisher? = null
    private var baseUs = -1L
    private var needKey = true
    private var lastV = -1L
    private var lastA = -1L
    private var state = State.CONNECTING
    private var kbps = 0

    private fun status() = listener.onStatus(Status(state, kbps, target / 1000, dropped, reconnects, lastError))

    private fun run() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        var backoffMs = 1_000L
        var failingSince = 0L
        var lastStat = System.nanoTime()
        var lastSent = 0L
        var calmSince = 0L
        var lastAdjust = 0L
        try {
            while (!stopped) {
                if (pub == null) {
                    // Wait for the encoder's configuration before talking to the server.
                    if (avcConfig == null) { Thread.sleep(50); continue }
                    if (asc == null && !noAudio && queue.none { !it.video }) { Thread.sleep(50); if (queue.size < 200) continue }
                    status()
                    try {
                        val p = RtmpPublisher(url, key)
                        p.connect()
                        p.sendHeaders(width, height, fps, target / 1000, avcConfig!!, if (noAudio) null else asc, sampleRate, channels)
                        p.flush()
                        pub = p
                        lastSent = 0L
                        configChanged = false
                        needKey = true
                        keyWanted.set(true)
                        state = State.LIVE
                        if (liveSinceMs == 0L || failingSince != 0L) liveSinceMs = System.currentTimeMillis()
                        failingSince = 0L
                        backoffMs = 1_000L
                        lastError = null
                        status()
                    } catch (e: Exception) {
                        lastError = e.message ?: e.javaClass.simpleName
                        if (failingSince == 0L) failingSince = System.currentTimeMillis()
                        if (System.currentTimeMillis() - failingSince > 180_000L || (reconnects == 0 && sent == 0L && e.message?.contains("refused") == true)) {
                            state = State.FAILED; status(); return
                        }
                        state = if (sent == 0L) State.CONNECTING else State.RECONNECTING
                        status()
                        // Nothing piles up while away: the stream resumes at a fresh key frame.
                        dropped += queue.count { it.video }; queue.clear()
                        Thread.sleep(backoffMs)
                        backoffMs = (backoffMs * 2).coerceAtMost(15_000L)
                        continue
                    }
                }
                val p = pub!!
                val k = queue.poll(200, TimeUnit.MILLISECONDS)
                val now = System.nanoTime()
                if (now - lastStat >= 1_000_000_000L) {
                    kbps = ((p.bytesSent - lastSent) * 8 / 1000).toInt()
                    lastSent = p.bytesSent
                    lastStat = now
                    sent = sentBefore + p.bytesSent
                    status()
                }
                if (k == null) { try { p.flush() } catch (e: IOException) { lost(e) }; continue }

                // Automatic quality: how long the oldest waiting frame has waited.
                val lagUs = lastEnqueuedPts - k.pts
                if (k.video && lagUs > 2_500_000L) {
                    // Far behind: drop what is waiting, ask for a key frame, lower the bit rate.
                    dropped += 1 + queue.count { it.video }
                    queue.removeIf { it.video }
                    needKey = true; keyWanted.set(true)
                    adjust((target * 0.7).toInt()); lastAdjust = now; calmSince = 0L
                    continue
                }
                if (lagUs > 1_000_000L && now - lastAdjust > 2_000_000_000L) { adjust((target * 0.8).toInt()); lastAdjust = now; calmSince = 0L }
                else if (lagUs < 250_000L) {
                    if (calmSince == 0L) calmSince = now
                    if (target < maxBitrate && now - calmSince > 10_000_000_000L && now - lastAdjust > 5_000_000_000L) {
                        adjust((target * 1.1).toInt().coerceAtMost(maxBitrate)); lastAdjust = now; calmSince = now
                    }
                } else calmSince = 0L

                try {
                    if (k.video) {
                        if (needKey && !k.key) { dropped++; continue }
                        if (configChanged && k.key) { p.sendVideoConfig(avcConfig!!); configChanged = false }
                        needKey = false
                        if (baseUs < 0) baseUs = k.pts
                        var ms = (k.pts - baseUs) / 1000
                        if (ms <= lastV) ms = lastV + 1
                        lastV = ms
                        p.sendVideo(ms, k.key, k.data, 0, k.data.size)
                    } else {
                        if (baseUs < 0 || k.pts < baseUs) continue
                        var ms = (k.pts - baseUs) / 1000
                        if (ms <= lastA) ms = lastA + 1
                        lastA = ms
                        p.sendAudio(ms, k.data, 0, k.data.size)
                    }
                    if (queue.isEmpty()) p.flush()
                } catch (e: IOException) { lost(e) }
            }
        } catch (_: InterruptedException) {
        } finally {
            if (liveSinceMs > 0 && state == State.LIVE) totalLiveMs += System.currentTimeMillis() - liveSinceMs
            try { pub?.close() } catch (_: Exception) {}
            sent = sentBefore + (pub?.bytesSent ?: 0L)
            pub = null
            if (state != State.FAILED) state = State.ENDED
            status()
        }
    }

    private fun lost(e: IOException) {
        lastError = e.message ?: "connection lost"
        if (liveSinceMs > 0) totalLiveMs += System.currentTimeMillis() - liveSinceMs
        try { pub?.close() } catch (_: Exception) {}
        sentBefore += pub?.bytesSent ?: 0L
        sent = sentBefore
        pub = null
        reconnects++
        state = State.RECONNECTING
        needKey = true
        keyWanted.set(true)
        status()
    }

    private fun adjust(bps: Int) {
        val b = bps.coerceIn(1_000_000, maxBitrate)
        if (b == target) return
        target = b
        listener.onBitrate(b)
    }
}

/** Where the recorder writes: an MP4 file ([SegMuxer]) or a live stream ([RtmpSink]). */
interface MediaSink {
    fun submitVideo(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int): Boolean
    fun submitAudio(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int)
    fun videoFormat(f: MediaFormat)
    fun audioFormat(f: MediaFormat)
    fun newPart(discardCurrent: Boolean)
    fun encoderReplaced()
    fun dropAudio()
    fun finish()
    fun emergencyFinish(timeoutMs: Long)
    fun parts(): List<SegMuxer.Part>
    val allClosed: Boolean
    val totalBytes: Long
    val videoBytes: Long
    val waitNs: Long
}
