package com.vil3ntec.rawrec.desktop

import java.util.concurrent.atomic.AtomicReference

/**
 * One phone on the cable: the link, its decoder, the latest picture for the preview, and a recording
 * when one runs. The window only shows [state] and [latest]; everything happens here, so the same
 * session runs in the window and in the command-line self-test.
 */
class Session(val adb: Adb, private val onChange: (State) -> Unit = {}) {

    enum class Phase { IDLE, CONNECTING, LIVE }

    data class State(
        val phase: Phase = Phase.IDLE,
        val device: String = "",
        val codec: String = "",
        val width: Int = 0, val height: Int = 0,
        val fps: Int = 0, val mbps: Double = 0.0,
        val audio: String = "",
        val recording: Boolean = false, val recSeconds: Long = 0, val recBytes: Long = 0, val recDropped: Long = 0,
        val lastFile: String = "", val lastResult: String = "",
        val error: String? = null,
    )

    /** The newest picture for the preview (BGRA, packed rows), replaced at every picture. */
    class Picture(val width: Int, val height: Int, val bgra: ByteArray, val seq: Long)

    @Volatile var state = State(); private set
    val latest = AtomicReference<Picture?>(null)
    private var link: PhoneLink? = null
    private var decoder: VideoDecoder? = null
    @Volatile private var recording: Recording? = null
    private var seq = 0L
    private var frames = 0; private var bytes = 0L; private var statAt = System.nanoTime()
    private var ticker: Thread? = null

    private fun set(s: State) { state = s; onChange(s) }

    fun connect(serial: String, opt: PhoneLink.Options) {
        if (state.phase != Phase.IDLE) return
        set(State(phase = Phase.CONNECTING))
        val l = PhoneLink(adb, serial, opt, object : PhoneLink.Events {
            override fun onDeviceName(name: String) = set(state.copy(device = name))
            override fun onVideoFormat(codec: String, width: Int, height: Int) {
                decoder?.close()
                decoder = VideoDecoder(codec)
                set(state.copy(phase = Phase.LIVE, codec = codec, width = width, height = height))
            }
            override fun onVideoPacket(data: ByteArray, ptsUs: Long, config: Boolean, key: Boolean) {
                bytes += data.size
                decoder?.decode(data, ptsUs, config) { f ->
                    frames++
                    recording?.video(f)
                    val b = ByteArray(f.width * f.height * 4)
                    val src = f.bgra.duplicate(); src.clear(); src.get(b)
                    latest.set(Picture(f.width, f.height, b, ++seq))
                    if (f.width != state.width || f.height != state.height) set(state.copy(width = f.width, height = f.height))
                }
            }
            override fun onAudioPacket(data: ByteArray, ptsUs: Long) {
                if (state.audio != "on") set(state.copy(audio = "on"))
                recording?.audio(data, ptsUs)
            }
            override fun onAudioUnavailable(why: String) = set(state.copy(audio = why))
            override fun onEnded(error: String?) {
                stopRecording()
                cleanup()
                set(State(error = error ?: state.error, lastFile = state.lastFile, lastResult = state.lastResult))
            }
        })
        link = l
        try {
            l.start()
        } catch (e: Exception) {
            cleanup()
            set(State(error = e.message ?: e.javaClass.simpleName))
            return
        }
        ticker = Thread({ tick() }, "session-stats").apply { isDaemon = true; start() }
    }

    /** Once a second: what comes from the phone (pictures, Mbps) and how the recording goes. */
    private fun tick() {
        while (state.phase != Phase.IDLE) {
            Thread.sleep(1000)
            val now = System.nanoTime()
            val secs = (now - statAt) / 1e9
            val fps = (frames / secs).toInt(); val mbps = bytes * 8 / secs / 1e6
            frames = 0; bytes = 0; statAt = now
            val r = recording
            set(state.copy(fps = fps, mbps = mbps, recording = r != null,
                recSeconds = r?.let { (System.currentTimeMillis() - it.startedAtMs) / 1000 } ?: 0,
                recBytes = r?.bytes ?: 0, recDropped = r?.dropped ?: 0))
        }
    }

    fun startRecording(encoder: Encoders.Encoder, height: Int, fps: Int, kbps: Int, audio: Boolean) {
        if (recording != null || state.phase != Phase.LIVE) return
        recording = Recording(encoder, height, fps, kbps, audio).also { it.start() }
        set(state.copy(recording = true, recSeconds = 0, recBytes = 0, recDropped = 0))
    }

    fun stopRecording(): Recording.Result? {
        val r = recording ?: return null
        recording = null
        val res = r.stop()
        val text = if (res.error != null) "error: ${res.error}" else
            "${res.width}×${res.height} • ${"%.1f".format(res.seconds)} s • ${res.frames} frames • dropped ${res.dropped} • ${res.bytes / 1_048_576} MB • ${res.encoder}"
        set(state.copy(recording = false, lastFile = res.file.absolutePath, lastResult = text))
        return res
    }

    /** Ends the link; the picture's thread then closes the decoder and says the session is idle (onEnded). */
    fun disconnect() {
        stopRecording()
        link?.stop()
    }

    private fun cleanup() {
        link = null
        val d = decoder; decoder = null
        try { d?.close() } catch (_: Throwable) {}
        latest.set(null)
    }
}
