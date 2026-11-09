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
 *   video bit rate goes down at once — as far as 250 kbps — and when it keeps up again for a while
 *   it goes back up to the chosen quality. Nothing is dropped for a slow patch: the picture arrives
 *   later, whole (5.2; before, frames 6 s late were thrown away and the viewers saw the stream jump).
 * - **Real time first (6.4, as OBS):** the stream never falls more than [RateControl.HARD_US] behind:
 *   YouTube's player stalls («a second, then ten seconds nothing») whenever it is fed slower than
 *   real time. The rate goes down long before that; beyond it what waits is let go and a key frame
 *   follows at once. A reconnect starts fresh at a key frame.
 */
class RtmpSink(
    private val url: String,
    private val key: String,
    private val maxBitrate: Int,
    private val listener: Listener,
    /** Automatic quality ([RateControl]); false = the owner's rate exactly, never changed. */
    private val adaptive: Boolean = true,
    /** Where the automatic rate starts (bits a second; 0 = the controller's own start): what the link carried last time. */
    private val startBps: Int = 0,
) : MediaSink {

    enum class State { CONNECTING, LIVE, RECONNECTING, FAILED, ENDED }

    /**
     * [why] what the last failed connection means for the owner, [route] how the stream goes
     * (through the phone's proxy or straight), [noPicture] the encoder gave no picture yet.
     */
    class Status(
        val state: State, val kbps: Int, val targetKbps: Int, val dropped: Int, val reconnects: Int, val error: String?,
        val why: RtmpPublisher.Why? = null, val route: String? = null, val noPicture: Boolean = false,
        /** How far behind real time the oldest waiting frame is (ms): the report's measure of a stall. */
        val lagMs: Int = 0,
    )

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
    /** The encoder gives HEVC: sent over Enhanced RTMP (YouTube). */
    @Volatile var hevc = false; private set
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
    @Volatile private var lastWhy: RtmpPublisher.Why? = null
    @Volatile private var route: String? = null
    @Volatile private var noPicture = false
    private val bornMs = System.currentTimeMillis()

    /** An error as it may be shown and kept: never with the stream key in it. */
    private fun scrub(m: String?): String? {
        val k = key.trim().substringBefore('?')
        return if (m == null || k.length < 4) m else m.replace(k, "•••")
    }

    // ------------------------------------------------------------ MediaSink (encoder threads)

    override fun submitVideo(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int): Boolean {
        if (stopped) return false
        val key = flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
        val raw = ByteArray(size)
        src.duplicate().apply { limit(offset + size); position(offset) }.get(raw)
        // parameter sets and delimiters go in the configuration, not in the frames (H.264 7–9, HEVC 32–35)
        val nals = Mp4Writer.nals(raw).filter { if (hevc) ((it[0].toInt() shr 1) and 0x3F) !in 32..35 else (it[0].toInt() and 0x1F) !in 7..9 }
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
        hevc = f.getString(MediaFormat.KEY_MIME) == MediaFormat.MIMETYPE_VIDEO_HEVC
        val box = try { if (hevc) Mp4Writer.hvcC(csd) else Mp4Writer.avcC(csd) } catch (_: Exception) { return }
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

    private fun status() = listener.onStatus(Status(state, kbps, target / 1000, dropped, reconnects, lastError, lastWhy, route, noPicture, lastLagMs))
    @Volatile private var lastLagMs = 0

    private fun run() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        var backoffMs = 1_000L
        var failingSince = 0L
        var lastStat = System.nanoTime()
        var lastSent = 0L
        try {
            while (!stopped) {
                if (pub == null) {
                    // Wait for the encoder's configuration before talking to the server.
                    if (avcConfig == null) {
                        // no picture from the encoder after a few seconds: said, not waited for in silence
                        if (!noPicture && System.currentTimeMillis() - bornMs > 6_000L) {
                            noPicture = true; lastError = "no picture from the encoder yet"; status()
                        }
                        Thread.sleep(50); continue
                    }
                    if (noPicture) { noPicture = false; lastError = null }
                    if (asc == null && !noAudio && queue.none { !it.video }) { Thread.sleep(50); if (queue.size < 200) continue }
                    status()
                    try {
                        val p = RtmpPublisher(url, key)
                        p.hevc = hevc
                        p.connect()
                        p.sendHeaders(width, height, fps, target / 1000, avcConfig!!, if (noAudio) null else asc, sampleRate, channels)
                        p.flush()
                        pub = p
                        lastSent = 0L
                        configChanged = false
                        needKey = true
                        keyWanted.set(true)
                        state = State.LIVE
                        // the encoder starts at the controller's gentle starting rate (it runs by now)
                        if (!started) { started = true; apply(rate.target) }
                        if (liveSinceMs == 0L || failingSince != 0L) liveSinceMs = System.currentTimeMillis()
                        failingSince = 0L
                        backoffMs = 1_000L
                        lastError = null
                        lastWhy = null
                        route = p.route
                        status()
                    } catch (e: Exception) {
                        lastError = scrub(e.message ?: e.javaClass.simpleName)
                        lastWhy = (e as? RtmpPublisher.Failure)?.why ?: RtmpPublisher.classify(e, null, proxy = false)
                        if (failingSince == 0L) failingSince = System.currentTimeMillis()
                        // the server itself said no (application or key) on the very first try: no use trying for minutes
                        if (System.currentTimeMillis() - failingSince > 180_000L || (reconnects == 0 && sent == 0L && lastWhy == RtmpPublisher.Why.REJECTED)) {
                            // given up: nothing more is taken in (with other platforms still streaming, frames keep coming)
                            stopped = true; queue.clear()
                            state = State.FAILED; status(); return
                        }
                        state = if (sent == 0L) State.CONNECTING else State.RECONNECTING
                        status()
                        // 6.4: real time first (as OBS): what was made while away is let go, the stream resumes at a fresh
                        // key frame. Sending a backlog would feed YouTube slower than real time — the viewers' player
                        // then plays a second and waits ten (what the owner saw with 5.2's kept backlog).
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
                    rate.measured(kbps * 1000)
                    lastSent = p.bytesSent
                    lastStat = now
                    sent = sentBefore + p.bytesSent
                    if (bound()) { needKey = true; keyWanted.set(true) }
                    status()
                }
                if (k == null) { try { p.flush() } catch (e: IOException) { lost(e) }; continue }

                // Automatic quality ([RateControl]): how long the oldest waiting frame has waited, and
                // what the connection really carried, decide the encoder's bit rate.
                val lagUs = lastEnqueuedPts - k.pts
                lastLagMs = (lagUs / 1000).toInt().coerceAtLeast(0)
                // 6.5: the chosen rate is a ceiling, never more than the link carries — a manual 51 Mbps on a
                // 3 Mbps link lost 27 % of the frames and stalled the viewers (the owner's report). The
                // same controller for both; manual starts at, and returns to, the chosen rate
                when (rate.step(now, lagUs, k.video)) {
                    RateControl.Act.DROP -> {
                        // too far behind real time (the link fell away): what waits is let go, a key frame at once —
                        // a short freeze for the viewers instead of minutes of «one second, then ten seconds nothing»
                        if (k.video) dropped++
                        dropped += queue.count { it.video }
                        queue.removeIf { it.video }
                        needKey = true; keyWanted.set(true)
                        apply(rate.target)
                        continue
                    }
                    RateControl.Act.SET -> apply(rate.target)
                    RateControl.Act.NONE -> {}
                }

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
        lastError = scrub(e.message ?: "connection lost")
        lastWhy = null
        if (liveSinceMs > 0) totalLiveMs += System.currentTimeMillis() - liveSinceMs
        try { pub?.close() } catch (_: Exception) {}
        sentBefore += pub?.bytesSent ?: 0L
        sent = sentBefore
        pub = null
        reconnects++
        state = State.RECONNECTING
        needKey = true
        keyWanted.set(true)
        // when it is back, the frames made meanwhile go out first: at half the rate, so they drain
        rate.lost(System.nanoTime()); apply(rate.target)
        status()
    }

    /** Far too much waiting (a long break): the oldest goes, back to a key frame about [keepUs] behind the newest. */
    private fun cutBackTo(keepUs: Long) {
        while (true) {
            val h = queue.peekFirst() ?: return
            if (h.video && h.key && lastEnqueuedPts - h.pts <= keepUs) return
            queue.pollFirst(); if (h.video) dropped++
        }
    }

    /** The waiting frames never take more than [MAX_QUEUE_BYTES] of memory; true when some had to go. */
    private fun bound(): Boolean {
        if (queue.size < 800) return false
        var bytes = 0L
        for (p in queue) bytes += p.data.size
        if (bytes <= MAX_QUEUE_BYTES) return false
        cutBackTo(RateControl.BACK_US)
        return true
    }

    private val rate = RateControl(maxBitrate, startBps = if (adaptive) startBps else maxBitrate)
    private var started = false

    companion object {
        /** The most the waiting frames may hold (64 MB). */
        const val MAX_QUEUE_BYTES = 64L * 1024 * 1024
    }

    private fun apply(bps: Int) {
        if (bps == target) return
        target = bps
        listener.onBitrate(bps)
    }
}

/**
 * The stream's automatic quality, by what the connection really carries (4.2).
 *
 * 4.0 kept the rate at least 40 % of the chosen one and went back up every 5 s: on a link (a VPN)
 * that carried less, the frames piled up, were dropped every few seconds, the rate went up again —
 * the stream on YouTube cut out every 3–4 s. Now:
 *  - **never a cut for a short slow patch** (the owner: «up to 5 s of delay is fine, no cuts»):
 *    1.5 s behind → the lower of ¾ of the rate and 85 % of what the connection carried in the last
 *    seconds; down to 1 Mbps if that is all there is;
 *  - **up slowly and never straight back into the wall:** after 10 s without delay, +10 % at most
 *    every 8 s, and for a minute after the connection could not keep up, not above 90 % of the rate
 *    it could not carry;
 *  - the rate goes as far down as 250 kbps; more than [FAR_US] behind, to half of what the link
 *    carries, so what waits drains quickly (and the service makes the picture smaller, as the
 *    platforms' own quality ladders do, so few bits still look clean);
 *  - 6.4: never more than [HARD_US] behind real time: 5.2 kept up to 45 s of backlog, and YouTube,
 *    fed slower than real time, made its viewers wait («a second, then ten seconds nothing»).
 *  - the start is where the link was last time ([startBps]), so a narrow link is not hit at 6 Mbps.
 */
class RateControl(private val maxBps: Int, private val floorBps: Int = minOf(FLOOR_BPS, maxBps), startBps: Int = 0) {
    enum class Act { NONE, SET, DROP }

    /**
     * A gentle start: at most 6 Mbps for the first seconds, then up quickly while the link keeps up
     * (+20 % every 3 s) — a weak link is found before a pile of frames made at the full rate cuts the
     * stream; a good one reaches the chosen rate within about 15 s.
     */
    var target = minOf(maxBps, maxOf(floorBps, if (startBps > 0) startBps else START_BPS)); private set
    private var lastAdjust = 0L
    private var calmSince = 0L
    /** How far behind it was when last lowered (0 = caught up since). */
    private var lagAtAdjust = 0L
    private var capBps = maxBps
    /** The highest rate the link carried for 10 s with no more than a short delay (0 = none yet): a dip comes back to it quickly. */
    private var goodBps = 0
    private var okSince = 0L
    private var lastReturnNs = 0L
    private var capUntil = 0L
    private val seen = IntArray(3)
    private var seenN = 0

    /** What the connection carried in the last second (bits). */
    fun measured(bps: Int) { seen[seenN % seen.size] = bps; seenN++ }

    /** The connection's recent rate (the mean of the last seconds; 0 = not known yet). */
    val link: Int get() = if (seenN == 0) 0 else (0 until minOf(seenN, seen.size)).sumOf { seen[it].toLong() }.div(minOf(seenN, seen.size)).toInt()

    private var firstNs = 0L
    /** The last lowering was made before the link's rate was known. */
    private var blind = false

    fun step(nowNs: Long, lagUs: Long, video: Boolean): Act {
        if (firstNs == 0L) firstNs = nowNs
        if (lagUs < SLOW_US) { if (okSince == 0L) okSince = nowNs; if (nowNs - okSince > 10_000_000_000L && target > goodBps) goodBps = target }
        else okSince = 0L
        // the first 15 s: the chosen rate may be far above what the link carries — found out sooner,
        // before the frames made meanwhile pile up into a cut
        val slowUs = if (nowNs - firstNs < 15_000_000_000L) 700_000L else SLOW_US
        if (video && lagUs > HARD_US) {
            behind(nowNs)
            set(minOf((target * 0.6).toInt(), link.takeIf { it > 0 }?.let { (it * 0.8).toInt() } ?: Int.MAX_VALUE))
            lastAdjust = nowNs; calmSince = 0L
            return Act.DROP
        }
        if (lagUs > slowUs) {
            calmSince = 0L
            // once lowered (to what the link carried), the frames made before still have to go out and the
            // delay grows a little longer: lowered again only after 4 s, or sooner when 3 s behind
            val starting = nowNs - firstNs < 15_000_000_000L
            val far = lagUs > FAR_US
            val wait = when {
                lagAtAdjust == 0L -> 0L
                far || blind || starting -> 1_000_000_000L    // far behind, or lowered before the link was known: look again soon
                lagUs > 3_000_000L -> 1_500_000_000L
                else -> 4_000_000_000L
            }
            if (nowNs - lastAdjust < wait) return Act.NONE
            val l = link
            // already below what the link carries: the delay is only frames made before going out —
            // lowered further only when 3 s behind, and never below 70 % of the link (no needless blocks)
            if (l > 0 && target <= l * 0.85 && lagUs <= 3_000_000L) return Act.NONE
            // far behind and already at half the link: what waits is draining; nothing more to do
            if (far && l > 0 && target <= l * 0.5) return Act.NONE
            behind(nowNs)
            lastAdjust = nowNs; lagAtAdjust = lagUs; blind = l <= 0
            val want = when {
                l <= 0 -> target / 2                                    // the link not known yet: well down, found out next second
                far -> minOf((target * 0.75).toInt(), l / 2)            // far behind: half the link, so the backlog drains
                else -> maxOf(minOf((target * 0.75).toInt(), (l * 0.85).toInt()), (l * 0.7).toInt())
            }
            return if (set(minOf(want, target))) Act.SET else Act.NONE
        }
        lagAtAdjust = 0L
        if (lagUs < CALM_US) {
            if (calmSince == 0L) calmSince = nowNs
            // 6.8: back quickly to a rate the link carried before a dip (a VPN hiccup): +30 % every 2 s
            if (goodBps > 0 && target < goodBps * 0.85 && nowNs - calmSince > 3_000_000_000L && nowNs - lastAdjust > 2_000_000_000L) {
                lastAdjust = nowNs; lastReturnNs = nowNs
                return if (set(minOf((target * 1.3).toInt(), (goodBps * 0.9).toInt()))) Act.SET else Act.NONE
            }
            val cap = if (nowNs < capUntil) capBps else maxBps
            // never held back yet (the start): quicker steps; afterwards slow and careful
            val fresh = capUntil == 0L
            // 6.8: the link's room is only found by sending more (what went out is all that is measured):
            // after 5 s caught up, +15 % every 4 s (was +10 % every 8 s after 10 s — minutes at 1 Mbps on a 7 Mbps line)
            val calmFor = if (fresh) 3_000_000_000L else 5_000_000_000L
            val since = if (fresh) 3_000_000_000L else 4_000_000_000L
            // 7.1 (found streaming for real through a 3 Mbps link): only up when the link really carries the
            // current rate — the encoder sent 3 Mbps of a 5 Mbps target, the target climbed to 6 untested, the
            // encoder followed, the stream fell 4 s behind, frames were lost and the viewer froze for 10 s
            val filled = link >= target * 0.85
            if (filled && target < cap && nowNs - calmSince > calmFor && nowNs - lastAdjust > since) {
                lastAdjust = nowNs; calmSince = nowNs
                return if (set(minOf((target * (if (fresh) 1.2 else 1.15)).toInt(), cap))) Act.SET else Act.NONE
            }
        } else calmSince = 0L
        return Act.NONE
    }

    companion object {
        /** Behind this far: the rate is lowered. */
        const val SLOW_US = 1_500_000L
        /** Behind this far: well down at once (half the link), so what waits drains. */
        const val FAR_US = 2_500_000L
        /** Behind this far all the same (the link fell away): what waits is let go, a key frame next — real time kept. */
        const val HARD_US = 4_000_000L
        /** The memory bound's cut: back to a key frame about this far behind the newest. */
        const val BACK_US = 2_000_000L
        /** The least the rate goes to: a poor picture, but a whole one. */
        const val FLOOR_BPS = 250_000
        /** Caught up: the rate may go back up. */
        const val CALM_US = 400_000L
        /** Where a stream starts (see [target]). */
        const val START_BPS = 6_000_000
    }

    /** The connection broke: when it is back, the frames made meanwhile go out first — at half the rate, so they drain. */
    fun lost(nowNs: Long) { behind(nowNs); lastAdjust = nowNs; set(maxOf(floorBps, target / 2)) }

    /** The connection did not keep up at [target]: no going back above 90 % of it for a minute. */
    private fun behind(nowNs: Long) {
        // falling behind soon after going back up to the «good» rate: the link has really narrowed, not dipped
        if (goodBps > 0 && nowNs - lastReturnNs < 10_000_000_000L) goodBps = (target * 0.9).toInt()
        okSince = 0L
        capBps = maxOf(floorBps, (target * 0.9).toInt())
        capUntil = nowNs + 30_000_000_000L
    }

    private fun set(bps: Int): Boolean {
        val b = bps.coerceIn(floorBps, maxBps)
        if (b == target) return false
        target = b
        return true
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
