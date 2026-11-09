package com.vil3ntec.rawrec

import android.media.MediaFormat
import java.nio.ByteBuffer

/**
 * One stream to several platforms at once (YouTube, Twitch, Kick…): the picture and sound are
 * encoded once and each platform gets its own copy over its own connection ([RtmpSink]), so a
 * platform that drops out reconnects on its own while the others go on. The stream ends only when
 * every platform has given up. The bit rate follows the slowest connection still streaming.
 */
class MultiSink(dests: List<LiveSettings.Dest>, maxBitrate: Int, private val listener: RtmpSink.Listener, adaptive: Boolean = true, startBps: Int = 0) : MediaSink {

    class Dest(val name: String) {
        lateinit var sink: RtmpSink
        @Volatile var status: RtmpSink.Status? = null
        @Volatile var target = 0
    }

    val dests: List<Dest> = dests.map { Dest(it.name) }

    init {
        for ((i, d) in dests.withIndex()) {
            val mine = this.dests[i]
            mine.target = maxBitrate
            mine.sink = RtmpSink(d.url, d.key, maxBitrate, object : RtmpSink.Listener {
                override fun onStatus(s: RtmpSink.Status) {
                    mine.status = s
                    listener.onStatus(aggregate(this@MultiSink.dests.map { it.status }, this@MultiSink.dests.map { it.name }))
                }
                override fun onBitrate(bps: Int) {
                    mine.target = bps
                    listener.onBitrate(slowest())
                }
            }, adaptive, startBps)
        }
    }

    private fun slowest(): Int = dests.filter { it.status?.state != RtmpSink.State.FAILED && it.status?.state != RtmpSink.State.ENDED }
        .minOfOrNull { it.target } ?: dests.minOf { it.target }

    // every call goes to every platform (none skipped: each one asks for its own key frames)
    override fun submitVideo(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int): Boolean {
        var key = false
        for (d in dests) if (d.sink.submitVideo(src, offset, size, ptsUs, flags)) key = true
        return key
    }
    override fun submitAudio(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int) { for (d in dests) d.sink.submitAudio(src, offset, size, ptsUs, flags) }
    override fun videoFormat(f: MediaFormat) { for (d in dests) d.sink.videoFormat(f) }
    override fun audioFormat(f: MediaFormat) { for (d in dests) d.sink.audioFormat(f) }
    override fun newPart(discardCurrent: Boolean) { for (d in dests) d.sink.newPart(discardCurrent) }
    override fun encoderReplaced() { for (d in dests) d.sink.encoderReplaced() }
    override fun dropAudio() { for (d in dests) d.sink.dropAudio() }
    override fun finish() {
        val ts = dests.map { d -> Thread { d.sink.finish() }.apply { start() } }
        for (t in ts) try { t.join(4_000) } catch (_: InterruptedException) {}
    }
    override fun emergencyFinish(timeoutMs: Long) { for (d in dests) d.sink.emergencyFinish(timeoutMs / dests.size.coerceAtLeast(1)) }
    override fun parts(): List<SegMuxer.Part> = emptyList()
    override val allClosed: Boolean get() = true
    override val totalBytes: Long get() = dests.sumOf { it.sink.totalBytes }
    override val videoBytes: Long get() = totalBytes
    override val waitNs: Long get() = 0L

    companion object {
        /**
         * The whole stream as one status: live while any platform is live, failed only when every
         * one failed; the speeds and counts added up; the error names the platform it came from.
         */
        fun aggregate(all: List<RtmpSink.Status?>, names: List<String>): RtmpSink.Status {
            val states = all.map { it?.state ?: RtmpSink.State.CONNECTING }
            val state = when {
                states.all { it == RtmpSink.State.FAILED } -> RtmpSink.State.FAILED
                states.all { it == RtmpSink.State.FAILED || it == RtmpSink.State.ENDED } -> RtmpSink.State.ENDED
                states.any { it == RtmpSink.State.LIVE } -> RtmpSink.State.LIVE
                states.any { it == RtmpSink.State.RECONNECTING } -> RtmpSink.State.RECONNECTING
                else -> RtmpSink.State.CONNECTING
            }
            val live = all.filterNotNull()
            val bad = all.indices.firstOrNull { all[it]?.error != null && all[it]?.state != RtmpSink.State.LIVE }
            val err = bad?.let { names[it] + ": " + all[it]?.error }
            return RtmpSink.Status(state, live.sumOf { it.kbps }, live.filter { it.state == RtmpSink.State.LIVE }.minOfOrNull { it.targetKbps }
                ?: live.minOfOrNull { it.targetKbps } ?: 0, live.sumOf { it.dropped }, live.sumOf { it.reconnects }, err,
                bad?.let { all[it]?.why }, live.firstOrNull { it.state == RtmpSink.State.LIVE }?.route, live.any { it.noPicture })
        }
    }
}

/**
 * Live and a recording at once from one encoder: the very same frames go to the stream and to the
 * file (no second encoding, so the phone works no harder and gets no hotter). Should the file fail
 * (storage full), only the recording stops; the stream goes on.
 */
/**
 * The stream, and beside it a file that can be started and stopped while live (6.2: the ⏺ on the
 * panel). A file begun mid-stream starts at the next key frame (asked for at once), with the
 * encoder's formats replayed; a stopped one is closed and kept. Every file's parts are reported.
 */
class TeeSink(private val live: MediaSink, private val newFile: () -> MediaSink, startOn: Boolean) : MediaSink {
    @Volatile private var file: MediaSink? = null
    @Volatile private var awaitKey = false
    private val wantKey = java.util.concurrent.atomic.AtomicBoolean(false)
    private var vfmt: MediaFormat? = null
    private var afmt: MediaFormat? = null
    @Volatile private var noAudio = false
    private val done = java.util.concurrent.CopyOnWriteArrayList<MediaSink>()

    init { if (startOn) startFile() }

    /** Whether a file is being written right now. */
    val recording: Boolean get() = file != null

    /** A file from here on (the next key frame): true when one was started. */
    @Synchronized fun startFile(): Boolean {
        if (file != null) return false
        val f = newFile()
        if (noAudio) f.dropAudio()
        vfmt?.let { f.videoFormat(it) }
        afmt?.let { f.audioFormat(it) }
        awaitKey = true
        file = f
        wantKey.set(true)
        return true
    }

    /** The file is closed and kept; the stream goes on. True when one was open. */
    @Synchronized fun stopFile(): Boolean {
        val f = file ?: return false
        file = null
        done += f
        Thread({ try { f.finish() } catch (_: Exception) {} }, "rawrec-tee-close").start()
        return true
    }

    // the stream first: it only copies; the file may move the buffer's position
    override fun submitVideo(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int): Boolean {
        val a = live.submitVideo(src, offset, size, ptsUs, flags)
        var b = false
        val f = file
        if (f != null) {
            val key = flags and android.media.MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
            if (awaitKey && key) awaitKey = false
            if (!awaitKey) b = f.submitVideo(src, offset, size, ptsUs, flags)
        }
        return a || b || wantKey.getAndSet(false)
    }
    override fun submitAudio(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int) {
        live.submitAudio(src, offset, size, ptsUs, flags)
        val f = file
        if (f != null && !awaitKey) f.submitAudio(src, offset, size, ptsUs, flags)
    }
    override fun videoFormat(f: MediaFormat) { vfmt = f; live.videoFormat(f); file?.videoFormat(f) }
    override fun audioFormat(f: MediaFormat) { afmt = f; live.audioFormat(f); file?.audioFormat(f) }
    override fun newPart(discardCurrent: Boolean) { live.newPart(discardCurrent); file?.newPart(discardCurrent) }
    override fun encoderReplaced() { live.encoderReplaced(); file?.encoderReplaced() }
    override fun dropAudio() { noAudio = true; live.dropAudio(); file?.dropAudio() }
    override fun finish() {
        val t = Thread({ try { live.finish() } catch (_: Exception) {} }, "rawrec-tee-live").apply { start() }
        val f = file; file = null
        if (f != null) { done += f; f.finish() }
        try { t.join(5_000) } catch (_: InterruptedException) {}
    }
    override fun emergencyFinish(timeoutMs: Long) {
        live.emergencyFinish(timeoutMs / 3)
        val f = file; file = null
        if (f != null) { done += f; f.emergencyFinish(timeoutMs * 2 / 3) }
    }
    private val all: List<MediaSink> get() = done + listOfNotNull(file)
    override fun parts(): List<SegMuxer.Part> = all.flatMap { it.parts() }
    override val allClosed: Boolean get() = all.all { it.allClosed }
    override val totalBytes: Long get() = all.sumOf { it.totalBytes }
    override val videoBytes: Long get() = all.sumOf { it.videoBytes }
    override val waitNs: Long get() = file?.waitNs ?: 0L
}

/**
 * The stream ([main]) with the Shorts connection ([extra]) beside it: the sound goes to both, the
 * pictures only to [main] (the tall picture has its own encoder, see Recorder.startShorts). The
 * end of either is not the end of the other.
 */
class SoundToo(private val main: MediaSink, private val extra: MediaSink) : MediaSink {
    override fun submitVideo(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int) = main.submitVideo(src, offset, size, ptsUs, flags)
    override fun submitAudio(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int) {
        extra.submitAudio(src, offset, size, ptsUs, flags)   // it only copies; [main] may move the position
        main.submitAudio(src, offset, size, ptsUs, flags)
    }
    override fun videoFormat(f: MediaFormat) = main.videoFormat(f)
    override fun audioFormat(f: MediaFormat) { extra.audioFormat(f); main.audioFormat(f) }
    override fun newPart(discardCurrent: Boolean) = main.newPart(discardCurrent)
    override fun encoderReplaced() = main.encoderReplaced()
    override fun dropAudio() { extra.dropAudio(); main.dropAudio() }
    override fun finish() {
        val t = Thread({ try { extra.finish() } catch (_: Exception) {} }, "rawrec-shorts-end").apply { start() }
        main.finish()
        try { t.join(4_000) } catch (_: InterruptedException) {}
    }
    override fun emergencyFinish(timeoutMs: Long) { extra.emergencyFinish(timeoutMs / 3); main.emergencyFinish(timeoutMs * 2 / 3) }
    override fun parts(): List<SegMuxer.Part> = main.parts()
    override val allClosed: Boolean get() = main.allClosed
    override val totalBytes: Long get() = main.totalBytes
    override val videoBytes: Long get() = main.videoBytes
    override val waitNs: Long get() = main.waitNs
}
