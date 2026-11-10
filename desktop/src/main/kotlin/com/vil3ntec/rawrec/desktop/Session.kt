package com.vil3ntec.rawrec.desktop

import java.util.concurrent.atomic.AtomicReference

/**
 * One phone on the cable: the link, its decoder, the newest picture and the sound as it comes. What is
 * done with them (scenes, recording, live) is the studio's business; the same session runs in the
 * window and in the command-line self-test.
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
        val error: String? = null,
    )

    /** The newest picture (BGRA, packed rows), replaced at every picture. */
    class Picture(val width: Int, val height: Int, val bgra: ByteArray, val seq: Long)

    @Volatile var state = State(); private set
    val latest = AtomicReference<Picture?>(null)
    /** The phone's sound (16-bit stereo 48 kHz) as it arrives. */
    @Volatile var onAudio: ((ByteArray) -> Unit)? = null
    /** The size the studio shows the picture at (see [VideoDecoder.scaleTo]); null = as the phone sends it. */
    @Volatile var scaleTo: ((Int, Int) -> Pair<Int, Int>?)? = null
    private var link: PhoneLink? = null
    private var decoder: VideoDecoder? = null
    private var seq = 0L
    @Volatile private var frames = 0; @Volatile private var bytes = 0L; private var statAt = System.nanoTime()
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
                decoder?.scaleTo = scaleTo
                decoder?.decode(data, ptsUs, config) { f ->
                    frames++
                    val b = ByteArray(f.width * f.height * 4)
                    val src = f.bgra.duplicate(); src.clear(); src.get(b)
                    latest.set(Picture(f.width, f.height, b, ++seq))
                    val d = decoder
                    if (d != null && (d.srcW != state.width || d.srcH != state.height)) set(state.copy(width = d.srcW, height = d.srcH))
                }
            }
            override fun onAudioPacket(data: ByteArray, ptsUs: Long) {
                if (state.audio != "on") set(state.copy(audio = "on"))
                onAudio?.invoke(data)
            }
            override fun onAudioUnavailable(why: String) = set(state.copy(audio = why))
            override fun onEnded(error: String?) {
                cleanup()
                set(State(error = error ?: state.error))
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

    /** Once a second: what comes from the phone (pictures, Mbps). */
    private fun tick() {
        while (state.phase != Phase.IDLE) {
            Thread.sleep(1000)
            if (state.phase == Phase.IDLE) break
            val now = System.nanoTime()
            val secs = (now - statAt) / 1e9
            val fps = (frames / secs).toInt(); val mbps = bytes * 8 / secs / 1e6
            frames = 0; bytes = 0; statAt = now
            set(state.copy(fps = fps, mbps = mbps))
        }
    }

    /** Ends the link; the picture's thread then closes the decoder and says the session is idle (onEnded). */
    fun disconnect() { link?.stop() }

    private fun cleanup() {
        link = null
        val d = decoder; decoder = null
        try { d?.close() } catch (_: Throwable) {}
        latest.set(null)
    }
}
