package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.content.Context
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioPlaybackCaptureConfiguration
import android.media.AudioRecord
import android.media.AudioTimestamp
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.Process
import android.os.SystemClock
import android.view.Surface
import java.nio.ByteOrder
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicReference
import kotlin.math.abs

/**
 * Numbers for the «گزارشِ ضبط» (recording report). Written by the video thread only.
 * Frames can arrive out of display order (B-frames), so gaps are measured after a small re-order
 * window; no allocation per frame.
 */
class RecStats {
    @Volatile var frames = 0L
    @Volatile var keyFrames = 0L
    @Volatile var firstPtsUs = -1L
    @Volatile var lastPtsUs = -1L
    @Volatile var maxGapUs = 0L
    @Volatile var minGapUs = Long.MAX_VALUE
    @Volatile var longGaps = 0L          // gaps longer than 2.5 frame periods = real stalls
    @Volatile var rotations = 0
    @Volatile var skipNextGap = true
    private val win = LongArray(8)
    private var n = 0
    private var prev = -1L
    private var periodUs = 16_666L

    val durationUs get() = if (firstPtsUs < 0 || lastPtsUs <= firstPtsUs) 0L else lastPtsUs - firstPtsUs

    fun onFrame(ptsUs: Long, key: Boolean, period: Long) {
        periodUs = period
        if (firstPtsUs < 0 || ptsUs < firstPtsUs) firstPtsUs = ptsUs
        if (ptsUs > lastPtsUs) lastPtsUs = ptsUs
        frames++
        if (key) keyFrames++
        // insert sorted
        var i = n
        while (i > 0 && win[i - 1] > ptsUs) { win[i] = win[i - 1]; i-- }
        win[i] = ptsUs
        n++
        if (n > 4) emit()
    }

    fun flush() { while (n > 0) emit() }

    /** «شروعِ هوشمند»: the first seconds were thrown away, so the numbers start again with the file. */
    fun reset() {
        frames = 0; keyFrames = 0; firstPtsUs = -1; lastPtsUs = -1; maxGapUs = 0; minGapUs = Long.MAX_VALUE
        longGaps = 0; n = 0; prev = -1; skipNextGap = true
    }

    private fun emit() {
        val pts = win[0]
        System.arraycopy(win, 1, win, 0, n - 1)
        n--
        if (prev >= 0 && !skipNextGap) {
            val gap = pts - prev
            if (gap > maxGapUs) maxGapUs = gap
            if (gap in 1 until minGapUs) minGapUs = gap
            if (gap > periodUs * 5 / 2) longGaps++
        }
        skipNextGap = false
        prev = pts
    }
}

/**
 * Screen → hardware encoder → MP4, with nothing in between that could lower quality.
 * Video frames go from the virtual display straight into the encoder's input surface.
 */
class Recorder(
    private val ctx: Context,
    private val projection: MediaProjection,
    private val cfg: RecordConfig,
    initialPlan: CapturePlan,
    private val events: Events,
) : SegMuxer.Events {

    interface Events {
        /** The recording cannot go on; [detail] is the technical message for the report. */
        fun onFatal(reason: StopReason, detail: String)
        fun onAudioProblem(message: String)
        fun onRotated(plan: CapturePlan, restarted: Boolean)
        fun onPartOpened(index: Int, reason: Int)
        /** The video encoder failed and a new one took over; the recording goes on. */
        fun onRecovered(count: Int, detail: String) {}
        /** A write failed once; the part so far was closed cleanly and a new part follows. */
        fun onWriteRecovered(detail: String) {}
        fun onPartCreated(uri: Uri) {}
        fun onPartFinished(uri: Uri) {}
    }

    private class Switch(val plan: CapturePlan, val restart: Boolean)

    /** One configured video encoder. Rotation (or a failed encoder) replaces it with a new one. */
    private inner class VideoEnc(val plan: CapturePlan) {
        val codec: MediaCodec = MediaCodec.createByCodecName(plan.encoder)
        var surface: Surface? = null
        var dropped: List<String> = emptyList()

        fun prepare() {
            dropped = configure(codec, plan)
            surface = codec.createInputSurface()
            codec.start()
        }

        fun release() {
            try { codec.stop() } catch (_: Exception) {}
            try { codec.release() } catch (_: Exception) {}
            try { surface?.release() } catch (_: Exception) {}
        }
    }

    @Volatile private var running = false
    private var started = false
    private var stopped = false
    private val switchLock = Any()
    private val switchRequest = AtomicReference<Switch?>(null)

    @Volatile var plan: CapturePlan = initialPlan; private set
    @Volatile private var enc: VideoEnc? = null
    private var display: VirtualDisplay? = null
    private var videoThread: Thread? = null
    private var audioThread: Thread? = null
    private var aac: MediaCodec? = null
    private lateinit var muxer: SegMuxer
    val stats = RecStats()

    // pause / resume
    @Volatile var paused = false; private set
    @Volatile private var pausedTotalUs = 0L
    @Volatile private var pauseStartUs = 0L
    @Volatile private var resumeAtUs = 0L
    @Volatile private var needKeyAfterResume = false

    var droppedOptions: List<String> = emptyList(); private set
    /** Microphone muted from the floating control (game audio continues). */
    @Volatile var micMuted = false
    var audioKbps = 0; private set
    @Volatile var audioOk = false; private set
    /** Times the video encoder failed and was replaced without ending the recording. */
    @Volatile var recoveries = 0; private set
    private var lastRecoveryAt = 0L
    val parts: List<SegMuxer.Part> get() = if (::muxer.isInitialized) muxer.parts() else emptyList()
    val allPartsClosed: Boolean get() = !::muxer.isInitialized || muxer.allClosed
    val bytesWritten: Long get() = if (::muxer.isInitialized) muxer.totalBytes else 0L
    val videoBytes: Long get() = if (::muxer.isInitialized) muxer.videoBytes else 0L
    val muxWaitMs: Long get() = if (::muxer.isInitialized) muxer.waitNs / 1_000_000 else 0L

    /** The system stopped the capture display (it never resumes after that). */
    private val displayCallback = object : VirtualDisplay.Callback() {
        override fun onStopped() {
            if (running) events.onFatal(StopReason.DISPLAY_STOPPED, "VirtualDisplay stopped")
        }
    }

    /** On failure everything started so far is released again and the exception is rethrown. */
    fun start() {
        // Friendly name, e.g. "RawRec 2026-10-31 17-02.mp4"; parts become "… (۲).mp4".
        val stamp = SimpleDateFormat("yyyy-MM-dd HH-mm", Locale.US).format(Date())
        val prefix = if (cfg.testSeconds > 0) "RawRec test " else "RawRec "
        muxer = SegMuxer(ctx, cfg.hasAudio, cfg.segmentBytes, prefix + stamp, this)
        try {
            val first = VideoEnc(plan)
            try { first.prepare() } catch (e: Exception) { first.release(); throw e }
            droppedOptions = first.dropped
            enc = first

            if (cfg.hasAudio) {
                try { prepareAac() } catch (e: Exception) {
                    muxer.dropAudio()
                    events.onAudioProblem(e.message ?: "AAC")
                }
            }

            running = true
            started = true
            display = projection.createVirtualDisplay(
                "RawRec", plan.width, plan.height, plan.dpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
                first.surface, displayCallback, Handler(Looper.getMainLooper()),
            ) ?: throw IllegalStateException("virtual display not created")
            videoThread = Thread({ videoLoop() }, "rawrec-video").apply { start() }
            if (aac != null) audioThread = Thread({ audioLoop() }, "rawrec-audio").apply { start() }
        } catch (e: Exception) {
            running = false
            started = false
            stopped = true
            try { display?.release() } catch (_: Exception) {}
            display = null
            enc?.release()
            enc = null
            aac?.let { a -> try { a.release() } catch (_: Exception) {} }
            aac = null
            muxer.finish()
            throw e
        }
    }

    @Synchronized
    fun pause() {
        if (!running || paused) return
        pauseStartUs = System.nanoTime() / 1000
        paused = true
    }

    @Synchronized
    fun resume() {
        if (!running || !paused) return
        val now = System.nanoTime() / 1000
        pausedTotalUs += now - pauseStartUs
        resumeAtUs = now
        needKeyAfterResume = true
        stats.skipNextGap = true
        paused = false
        requestKeyFrame()
    }

    /**
     * Switch the encoder to the display's new orientation (or size). Whether to switch at all is
     * decided by [RotationPolicy] in the service (one debounced source, one switch per rotation); with
     * [restart] the part recorded so far is discarded and the recording starts over as a single file.
     */
    fun switchOrientation(d: DisplayInfo, restart: Boolean) {
        if (!running) return
        val next = Planner.replan(cfg, d, plan) ?: return
        switchRequest.set(Switch(next, restart))
    }

    /** Ends the recording: drains the encoders and finalizes every part (always a playable MP4). */
    fun stop() {
        val e: VideoEnc?
        synchronized(switchLock) {
            if (!started || stopped) return
            stopped = true
            running = false
            e = enc
            try { e?.codec?.signalEndOfInputStream() } catch (_: Exception) {}
        }
        videoThread?.join(5000)
        audioThread?.join(5000)
        stats.flush()
        try { display?.release() } catch (_: Exception) {}
        enc?.release()
        muxer.finish()
    }

    /**
     * The process is crashing: no draining, just close the MP4 parts within [timeoutMs] so what was
     * recorded stays playable. Safe from any thread, also while [stop] is running.
     */
    fun emergencyStop(timeoutMs: Long) {
        running = false
        try { enc?.codec?.signalEndOfInputStream() } catch (_: Throwable) {}
        if (::muxer.isInitialized) muxer.emergencyFinish(timeoutMs)
    }

    // ------------------------------------------------------------ video

    /**
     * Returns the optional keys the encoder refused. Tried with everything first; optional keys are
     * removed one group at a time only if configure() fails.
     */
    private fun configure(codec: MediaCodec, p: CapturePlan): List<String> {
        // Colour signalling goes last: without it the encoder converts with its own matrix (often
        // BT.601) while players assume BT.709 for HD, and the colours shift (1.4 dropped it together
        // with the profile).
        val steps = listOf(
            emptyList(),
            listOf("complexity"),
            listOf("complexity", "realtime"),
            listOf("complexity", "realtime", "level"),
            listOf("complexity", "realtime", "level", "qp"),
            listOf("complexity", "realtime", "level", "qp", "profile"),
            listOf("complexity", "realtime", "level", "qp", "profile", "bframes", "mode"),
            listOf("complexity", "realtime", "level", "qp", "profile", "bframes", "mode", "color"),
        )
        var last: Exception? = null
        for (drop in steps) {
            val f = MediaFormat.createVideoFormat(p.mime, p.width, p.height).apply {
                setInteger(MediaFormat.KEY_COLOR_FORMAT, MediaCodecInfo.CodecCapabilities.COLOR_FormatSurface)
                setInteger(MediaFormat.KEY_BIT_RATE, p.bitrate)
                setInteger(MediaFormat.KEY_FRAME_RATE, p.fps)
                // 3 s GOP: key frames are expensive; 1.0's 1 s GOP with CBR spent the budget on them
                // every second and starved the frames in between ("pulsing" blockiness).
                setInteger(MediaFormat.KEY_I_FRAME_INTERVAL, 3)
                // Static screens still produce frames, but only after two frame periods, so normal
                // frame-time jitter never inserts duplicate frames (judder).
                setLong(MediaFormat.KEY_REPEAT_PREVIOUS_FRAME_AFTER, 2_000_000L / p.fps)
                if ("mode" !in drop) {
                    setInteger(MediaFormat.KEY_BITRATE_MODE, Planner.codecMode(p.mode))
                    if (p.mode == RecordConfig.MODE_CQ && p.quality >= 0) setInteger(MediaFormat.KEY_QUALITY, p.quality)
                    // Headroom for fast motion: VBR may peak at 3× the target instead of blocking.
                    if (p.mode == RecordConfig.MODE_VBR) setInteger("max-bitrate", p.peakBitrate)
                }
                if ("qp" !in drop && p.qpMax > 0) {
                    // Quality floor per frame type (Android 12+ encoders): key frames a bit better,
                    // B-frames a bit cheaper. The QP minimum stops static screens from wasting bits.
                    setInteger(MediaFormat.KEY_VIDEO_QP_MAX, p.qpMax)
                    setInteger(MediaFormat.KEY_VIDEO_QP_I_MAX, p.qpMax - 2)
                    setInteger(MediaFormat.KEY_VIDEO_QP_P_MAX, p.qpMax)
                    setInteger(MediaFormat.KEY_VIDEO_QP_B_MAX, p.qpMax + 2)
                    setInteger(MediaFormat.KEY_VIDEO_QP_MIN, 10)
                }
                if ("complexity" !in drop && p.complexity >= 0) setInteger(MediaFormat.KEY_COMPLEXITY, p.complexity)
                // B-frames save size at equal quality; encoders that can't do them ignore the key.
                // (1.0 dropped out-of-order frames in the muxer, which made B-frames corrupt.)
                if ("bframes" !in drop && p.mime != Encoders.AV1) setInteger(MediaFormat.KEY_MAX_B_FRAMES, 2)
                if ("profile" !in drop && p.profile > 0) setInteger(MediaFormat.KEY_PROFILE, p.profile)
                if ("level" !in drop && "profile" !in drop && p.level > 0) setInteger(MediaFormat.KEY_LEVEL, p.level)
                if ("color" !in drop) {
                    // Surface input is RGB; ask for standard BT.709 limited-range video so players
                    // don't guess (wrong guesses look washed out or too dark).
                    setInteger(MediaFormat.KEY_COLOR_STANDARD, MediaFormat.COLOR_STANDARD_BT709)
                    setInteger(MediaFormat.KEY_COLOR_RANGE, MediaFormat.COLOR_RANGE_LIMITED)
                    setInteger(MediaFormat.KEY_COLOR_TRANSFER, MediaFormat.COLOR_TRANSFER_SDR_VIDEO)
                }
                if ("realtime" !in drop) {
                    setInteger(MediaFormat.KEY_PRIORITY, 0)
                    setInteger(MediaFormat.KEY_OPERATING_RATE, p.fps)
                    setFloat(MediaFormat.KEY_MAX_FPS_TO_ENCODER, p.fps.toFloat())
                }
            }
            try {
                codec.configure(f, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
                return drop
            } catch (e: Exception) {
                last = e
                codec.reset()
            }
        }
        throw IllegalStateException("encoder rejected settings: ${last?.message}")
    }

    private fun videoLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_DISPLAY)
        val info = MediaCodec.BufferInfo()
        var deadline = 0L
        while (true) {
            val failure: Exception? = try {
                val sw = switchRequest.getAndSet(null)
                if (sw != null && running) switchTo(sw, info)
                val e = enc ?: return
                if (!running) {
                    if (deadline == 0L) deadline = System.nanoTime() + 3_000_000_000L
                    else if (System.nanoTime() > deadline) return
                }
                val idx = e.codec.dequeueOutputBuffer(info, 10_000)
                if (idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) muxer.videoFormat(trackFormat(e))
                else if (idx >= 0 && deliver(e.codec, idx, info)) return
                null
            } catch (ex: Exception) { ex }
            if (failure != null) {
                if (!running) return
                if (!recoverEncoder(failure)) {
                    if (running) { running = false; events.onFatal(StopReason.ENCODER_ERROR, describe(failure)) }
                    return
                }
            }
        }
    }

    /**
     * The encoder's output format for the MP4 track. The colour keys the encoder was configured with
     * are added when the encoder leaves them out, so the file's 'colr' box says BT.709 limited range,
     * matching the conversion that was actually done (else players guess, and may guess wrong).
     */
    private fun trackFormat(v: VideoEnc): MediaFormat {
        val f = v.codec.outputFormat
        if ("color" !in v.dropped) {
            if (!f.containsKey(MediaFormat.KEY_COLOR_STANDARD)) f.setInteger(MediaFormat.KEY_COLOR_STANDARD, MediaFormat.COLOR_STANDARD_BT709)
            if (!f.containsKey(MediaFormat.KEY_COLOR_RANGE)) f.setInteger(MediaFormat.KEY_COLOR_RANGE, MediaFormat.COLOR_RANGE_LIMITED)
            if (!f.containsKey(MediaFormat.KEY_COLOR_TRANSFER)) f.setInteger(MediaFormat.KEY_COLOR_TRANSFER, MediaFormat.COLOR_TRANSFER_SDR_VIDEO)
        }
        return f
    }

    /**
     * A MediaCodec error in the middle of a recording (Android reclaimed the encoder for a game or the
     * camera, a driver hiccup): instead of ending the recording, the broken encoder is released and a
     * new one with the same settings is put behind the same virtual display. If its stream headers
     * match, the frames go on in the same file. Gives up when it keeps failing.
     */
    private fun recoverEncoder(cause: Exception): Boolean {
        val now = SystemClock.elapsedRealtime()
        if (recoveries >= MAX_RECOVERIES) return false
        if (lastRecoveryAt > 0 && now - lastRecoveryAt < 5_000) return false   // failed again at once: not passing
        val p = plan
        synchronized(switchLock) {
            if (!running) return false
            val vd = display
            try { vd?.surface = null } catch (_: Exception) {}
            // Free the hardware first: a reclaimed or crashed codec may still hold it.
            enc?.release()
            enc = null
            var next: VideoEnc? = null
            for (attempt in 1..3) {
                val n = try { VideoEnc(p) } catch (_: Exception) { null }
                if (n != null) {
                    try { n.prepare(); next = n } catch (_: Exception) { n.release() }
                }
                if (next != null) break
                try { Thread.sleep(250L * attempt) } catch (_: InterruptedException) { return false }
                if (!running) return false
            }
            val ok = next ?: return false
            try { vd?.surface = ok.surface } catch (_: Exception) { ok.release(); return false }
            enc = ok
            muxer.encoderReplaced()
            stats.skipNextGap = true
        }
        recoveries++
        lastRecoveryAt = now
        events.onRecovered(recoveries, describe(cause))
        return true
    }

    private fun describe(e: Exception): String {
        if (e !is MediaCodec.CodecException) return e.message ?: e.javaClass.simpleName
        val what = when (e.errorCode) {
            MediaCodec.CodecException.ERROR_RECLAIMED -> " reclaimed"
            MediaCodec.CodecException.ERROR_INSUFFICIENT_RESOURCE -> " insufficient-resource"
            else -> ""
        }
        return String.format(Locale.US, "MediaCodec 0x%x%s%s%s %s", e.errorCode, what,
            if (e.isTransient) " transient" else "", if (e.isRecoverable) " recoverable" else "", e.diagnosticInfo ?: "")
    }

    /** Copies one encoded frame to the muxer queue and returns the codec's buffer at once. */
    private fun deliver(codec: MediaCodec, idx: Int, info: MediaCodec.BufferInfo): Boolean {
        val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
        val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
        if (!isConfig && info.size > 0) {
            val out = codec.getOutputBuffer(idx)
            if (out != null) handleVideoFrame(out, info)
        }
        codec.releaseOutputBuffer(idx, false)
        return eos
    }

    private fun handleVideoFrame(buf: java.nio.ByteBuffer, info: MediaCodec.BufferInfo) {
        if (paused) return
        val pts = info.presentationTimeUs          // surface timestamp from the compositor, monotonic
        if (pts < resumeAtUs) return
        val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
        if (needKeyAfterResume) {
            if (!key) { requestKeyFrame(); return }
            needKeyAfterResume = false
        }
        val adj = pts - pausedTotalUs              // only shifts by the paused time; never wall-clock
        stats.onFrame(adj, key, 1_000_000L / plan.fps)
        if (muxer.submitVideo(buf, info.offset, info.size, adj, info.flags)) requestKeyFrame()
    }

    /**
     * Rotation in automatic mode: a new encoder at the new size, the virtual display resized onto
     * it, the old encoder drained into the current part. The muxer starts the next part at the new
     * encoder's first key frame (an MP4 track can't change resolution in the middle).
     */
    private fun switchTo(sw: Switch, info: MediaCodec.BufferInfo) {
        val p = sw.plan
        synchronized(switchLock) {
            if (!running) return
            val old = enc
            val vd = display
            var oldDone = false
            var next = newEncoder(p)
            if (next == null && old != null) {
                // Not enough encoder hardware for two at once (high sizes and frame rates): finish the
                // old encoder first, then start the new one. The part ends here anyway.
                try { vd?.surface = null } catch (_: Exception) {}
                drainAndRelease(old, info)
                enc = null
                oldDone = true
                next = newEncoder(p)
                if (next == null) {
                    // Keep recording in the old orientation rather than end the recording.
                    val back = newEncoder(plan) ?: throw IllegalStateException("no encoder after rotation")
                    try { vd?.surface = back.surface } catch (_: Exception) {}
                    enc = back
                    muxer.encoderReplaced()
                    events.onAudioProblem("rotate: encoder unavailable")
                    return
                }
            } else if (next == null) {
                events.onAudioProblem("rotate: encoder unavailable")
                return
            }
            try {
                vd?.surface = null
                vd?.resize(p.width, p.height, p.dpi)
                vd?.surface = next.surface
            } catch (_: Exception) {}
            if (old != null && !oldDone) drainAndRelease(old, info)
            // Ordered after the old encoder's last frame: the next key frame opens a new part.
            muxer.newPart(discardCurrent = sw.restart)
            enc = next
            plan = p
            if (sw.restart) stats.reset() else stats.rotations++
            stats.skipNextGap = true
        }
        events.onRotated(p, sw.restart)
    }

    /** A configured, started encoder for [p], or null when the device can't give one now. */
    private fun newEncoder(p: CapturePlan): VideoEnc? {
        val n = try { VideoEnc(p) } catch (_: Exception) { return null }
        return try { n.prepare(); n } catch (_: Exception) { n.release(); null }
    }

    /** Ends [old]'s stream and writes its last frames into the current part (at most 1.5 s). */
    private fun drainAndRelease(old: VideoEnc, info: MediaCodec.BufferInfo) {
        try {
            old.codec.signalEndOfInputStream()
            val end = System.nanoTime() + 1_500_000_000L
            while (System.nanoTime() < end) {
                val idx = old.codec.dequeueOutputBuffer(info, 10_000)
                if (idx >= 0 && deliver(old.codec, idx, info)) break
            }
        } catch (_: Exception) {}
        old.release()
    }

    private fun requestKeyFrame() {
        try {
            enc?.codec?.setParameters(Bundle().apply { putInt(MediaCodec.PARAMETER_KEY_REQUEST_SYNC_FRAME, 0) })
        } catch (_: Exception) {}
    }

    // ------------------------------------------------------------ audio

    private fun prepareAac() {
        val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        try {
            val range = codec.codecInfo.getCapabilitiesForType(MediaFormat.MIMETYPE_AUDIO_AAC)?.audioCapabilities?.bitrateRange
            val br = range?.clamp(320_000) ?: 256_000
            val fmt = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, RATE, 2).apply {
                setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
                setInteger(MediaFormat.KEY_BIT_RATE, br)
                setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16_384)
            }
            codec.configure(fmt, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            codec.start()
            aac = codec
            audioKbps = br / 1000
        } catch (e: Exception) {
            try { codec.release() } catch (_: Exception) {}
            throw e
        }
    }

    private fun newRecord(source: Int?, channelMask: Int, minBufMul: Int, floor: Int): AudioRecord {
        val minBuf = AudioRecord.getMinBufferSize(RATE, channelMask, AudioFormat.ENCODING_PCM_16BIT)
        val b = AudioRecord.Builder()
            .setAudioFormat(
                AudioFormat.Builder().setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(RATE).setChannelMask(channelMask).build()
            )
            .setBufferSizeInBytes(maxOf(minBuf * minBufMul, floor))
        if (source != null) b.setAudioSource(source)
        else b.setAudioPlaybackCaptureConfig(
            AudioPlaybackCaptureConfiguration.Builder(projection)
                .addMatchingUsage(AudioAttributes.USAGE_MEDIA)
                .addMatchingUsage(AudioAttributes.USAGE_GAME)
                .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN)
                .build()
        )
        val r = b.build()
        if (r.state != AudioRecord.STATE_INITIALIZED) { r.release(); throw IllegalStateException("AudioRecord not initialized") }
        return r
    }

    @SuppressLint("MissingPermission")
    private fun audioLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
        val codec = aac ?: return
        var internal: AudioRecord? = null
        var mic: AudioRecord? = null
        try {
            if (cfg.usesInternal) internal = newRecord(null, AudioFormat.CHANNEL_IN_STEREO, 4, 65_536)
            if (cfg.usesMic) mic = newRecord(MediaRecorder.AudioSource.MIC, AudioFormat.CHANNEL_IN_MONO, 4, 32_768)
            internal?.startRecording()
            mic?.startRecording()
            audioOk = true

            val frames = 1024
            val stereo = ShortArray(frames * 2)
            val mono = ShortArray(frames)
            val info = MediaCodec.BufferInfo()
            val gg = cfg.gameGain
            var startUs = -1L
            var totalFrames = 0L
            var errors = 0
            // The audio timeline counts samples (no gaps, no jitter) and is kept on the capture clock
            // of the stream that drives it: AudioRecord's timestamp says when a sample was really
            // captured on the same monotonic clock as the screen frames. Without it the start is off
            // by the input latency and a long recording drifts as the audio and system clocks differ.
            val clock = internal ?: mic
            val ts = AudioTimestamp()
            var framesRead = 0L          // frames read from [clock] since start, also while paused
            var offsetUs = 0L            // slewed correction on top of the sample count
            var lastClockCheckNs = 0L

            while (running) {
                val got: Int
                val chunkFrame = framesRead
                if (internal != null) {
                    val n = internal.read(stereo, 0, stereo.size, AudioRecord.READ_BLOCKING)
                    if (n <= 0) { if (++errors > 50) throw IllegalStateException("read error $n"); Thread.sleep(5); continue }
                    got = n / 2
                    if (gg != 1f) for (i in 0 until got * 2) stereo[i] = clamp((stereo[i] * gg).toInt())
                    if (mic != null) {
                        val mg = if (micMuted) 0f else cfg.micGain
                        val m = mic.read(mono, 0, got, AudioRecord.READ_NON_BLOCKING).coerceAtLeast(0)
                        for (i in 0 until m) {
                            val s = (mono[i] * mg).toInt()
                            stereo[2 * i] = clamp(stereo[2 * i] + s)
                            stereo[2 * i + 1] = clamp(stereo[2 * i + 1] + s)
                        }
                    }
                } else {
                    val m = mic?.read(mono, 0, frames, AudioRecord.READ_BLOCKING) ?: break
                    if (m <= 0) { if (++errors > 50) throw IllegalStateException("read error $m"); Thread.sleep(5); continue }
                    got = m
                    val mg = if (micMuted) 0f else cfg.micGain
                    for (i in 0 until m) {
                        val s = clamp((mono[i] * mg).toInt())
                        stereo[2 * i] = s; stereo[2 * i + 1] = s
                    }
                }
                errors = 0
                framesRead += got
                // While paused keep draining the recorders but encode nothing; timestamps come from
                // the sample count, so audio stays continuous across the pause like the video does.
                if (paused) continue
                val nowNs = System.nanoTime()
                if (startUs < 0) {
                    val guess = nowNs / 1000 - got * 1_000_000L / RATE
                    val cap = captureUs(clock, ts, chunkFrame)
                    startUs = (if (cap != null && abs(cap - guess) < 500_000) cap else guess) - pausedTotalUs
                    lastClockCheckNs = nowNs
                } else if (nowNs - lastClockCheckNs >= 1_000_000_000L) {
                    lastClockCheckNs = nowNs
                    val cap = captureUs(clock, ts, chunkFrame)
                    if (cap != null) {
                        val diff = cap - pausedTotalUs - (startUs + totalFrames * 1_000_000L / RATE + offsetUs)
                        // At most 2 ms per second: inaudible, far faster than any clock drift, and
                        // the timestamps keep rising (one chunk is 21 ms).
                        if (abs(diff) < 1_000_000) offsetUs += diff.coerceIn(-2_000L, 2_000L)
                    }
                }

                var offsetShorts = 0
                val totalShorts = got * 2
                while (offsetShorts < totalShorts && running) {
                    val inIdx = codec.dequeueInputBuffer(10_000)
                    if (inIdx < 0) { drainAudio(codec, info); continue }
                    val inBuf = codec.getInputBuffer(inIdx) ?: continue
                    inBuf.clear()
                    val count = minOf(totalShorts - offsetShorts, inBuf.capacity() / 4 * 2)
                    inBuf.order(ByteOrder.nativeOrder()).asShortBuffer().put(stereo, offsetShorts, count)
                    val pts = startUs + totalFrames * 1_000_000L / RATE + offsetUs
                    codec.queueInputBuffer(inIdx, 0, count * 2, pts, 0)
                    totalFrames += count / 2
                    offsetShorts += count
                }
                drainAudio(codec, info)
            }

            val inIdx = codec.dequeueInputBuffer(50_000)
            if (inIdx >= 0) {
                val pts = startUs.coerceAtLeast(0) + totalFrames * 1_000_000L / RATE + offsetUs
                codec.queueInputBuffer(inIdx, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                val end = System.nanoTime() + 1_000_000_000L
                while (System.nanoTime() < end) if (drainAudio(codec, info)) break
            }
        } catch (e: Exception) {
            if (running) {
                audioOk = false
                if (!audioFormatSent) muxer.dropAudio()
                events.onAudioProblem(e.message ?: e.javaClass.simpleName)
            }
        } finally {
            try { internal?.stop() } catch (_: Exception) {}
            try { internal?.release() } catch (_: Exception) {}
            try { mic?.stop() } catch (_: Exception) {}
            try { mic?.release() } catch (_: Exception) {}
            try { codec.stop() } catch (_: Exception) {}
            try { codec.release() } catch (_: Exception) {}
        }
    }

    private var audioFormatSent = false   // audio thread only

    /** Monotonic time (µs) at which frame [frame] of [r] was captured, or null if the device can't say. */
    private fun captureUs(r: AudioRecord?, ts: AudioTimestamp, frame: Long): Long? {
        r ?: return null
        return try {
            if (r.getTimestamp(ts, AudioTimestamp.TIMEBASE_MONOTONIC) != AudioRecord.SUCCESS) null
            else (ts.nanoTime + (frame - ts.framePosition) * 1_000_000_000L / RATE) / 1000
        } catch (_: Exception) { null }
    }

    /** @return true when the end of stream was reached. */
    private fun drainAudio(codec: MediaCodec, info: MediaCodec.BufferInfo): Boolean {
        while (true) {
            val idx = codec.dequeueOutputBuffer(info, 0)
            when {
                idx == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> { muxer.audioFormat(codec.outputFormat); audioFormatSent = true }
                idx >= 0 -> {
                    val buf = codec.getOutputBuffer(idx)
                    val isConfig = info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0
                    if (buf != null && !isConfig && info.size > 0) muxer.submitAudio(buf, info.offset, info.size, info.presentationTimeUs, info.flags)
                    codec.releaseOutputBuffer(idx, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) return true
                }
                else -> return false
            }
        }
    }

    private fun clamp(v: Int): Short = v.coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()

    // ------------------------------------------------------------ SegMuxer.Events

    override fun onAudioGivenUp() = events.onAudioProblem("timeout")
    override fun onPartOpened(index: Int, reason: Int) = events.onPartOpened(index, reason)
    override fun onWriteError(message: String) {
        if (running) { running = false; events.onFatal(StopReason.WRITE_ERROR, message) }
    }
    override fun onWriteRecovered(message: String) = events.onWriteRecovered(message)
    override fun onPartCreated(part: SegMuxer.Part) = events.onPartCreated(part.uri)
    override fun onPartFinished(part: SegMuxer.Part) = events.onPartFinished(part.uri)

    companion object {
        private const val RATE = 48_000
        private const val MAX_RECOVERIES = 5
    }
}
