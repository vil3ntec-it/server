package com.vil3ntec.rawrec.desktop

import java.io.DataInputStream
import java.io.EOFException
import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.security.SecureRandom

/**
 * The phone's screen and sound over the USB cable, through scrcpy's phone-side server (Apache 2.0,
 * bundled): the phone's own hardware encoder makes the picture at the rate chosen here — over a cable
 * it can be far more than any internet carries (40–100 Mbps), so what reaches the computer is
 * practically what the screen shows. Sound needs Android 11+. Nothing is installed on the phone; the
 * server is pushed to /data/local/tmp and removes itself when the link ends.
 *
 * Protocol (scrcpy 3.x, forward tunnel): the computer connects to the phone's socket «scrcpy_<scid>»
 * once for the picture and once for the sound. The first socket starts with one dummy byte and the
 * device name (64 bytes); each stream then sends its codec id (4 bytes) — the picture also its width and
 * height — and packets: an 8-byte time (µs; bit 63 = codec configuration, bit 62 = key frame), a 4-byte
 * size, the data.
 */
class PhoneLink(private val adb: Adb, private val serial: String, private val opt: Options, private val events: Events) {

    data class Options(
        /** "h265", "h264" or "av1" (the phone must have the encoder; h265 gives the most per bit). */
        val codec: String = "h265",
        val bitRateMbps: Int = 40,
        /** Longest side in pixels; 0 = the screen's own size. */
        val maxSize: Int = 0,
        val maxFps: Int = 60,
        val audio: Boolean = true,
    )

    interface Events {
        fun onVideoFormat(codec: String, width: Int, height: Int) {}
        fun onVideoPacket(data: ByteArray, ptsUs: Long, config: Boolean, key: Boolean)
        /** Raw sound: 16-bit little-endian PCM, 48 kHz, stereo. */
        fun onAudioPacket(data: ByteArray, ptsUs: Long) {}
        fun onAudioUnavailable(why: String) {}
        fun onDeviceName(name: String) {}
        /** The link ended (stopped here: [error] null). Called once, on the picture's thread, after its last packet. */
        fun onEnded(error: String?) {}
    }

    @Volatile private var running = false
    private var server: Process? = null
    private var videoSock: Socket? = null
    private var audioSock: Socket? = null
    private var port = 0
    private val threads = ArrayList<Thread>()
    @Volatile var deviceName = ""; private set
    @Volatile var videoCodec = ""; private set
    @Volatile var width = 0; private set
    @Volatile var height = 0; private set

    fun start() {
        check(!running) { "already running" }
        val jar = AppPaths.bundled("scrcpy/scrcpy-server") ?: throw IOException("scrcpy-server is missing from the app")
        val version = AppPaths.bundled("scrcpy/version")?.readText()?.trim() ?: throw IOException("scrcpy version is missing from the app")
        running = true
        val push = adb.run("-s", serial, "push", jar.absolutePath, REMOTE, timeoutMs = 30_000)
        if (!push.ok) fail("push: ${push.err.ifBlank { push.out }.trim()}")
        val scid = String.format("%08x", SecureRandom().nextInt() and 0x7fffffff)
        port = freePort()
        val fwd = adb.run("-s", serial, "forward", "tcp:$port", "localabstract:scrcpy_$scid")
        if (!fwd.ok) fail("forward: ${fwd.err.trim()}")
        val args = buildList {
            add("CLASSPATH=$REMOTE"); add("app_process"); add("/"); add("com.genymobile.scrcpy.Server"); add(version)
            add("scid=$scid"); add("log_level=info"); add("tunnel_forward=true"); add("control=false"); add("cleanup=true")
            add("video_codec=${opt.codec}"); add("video_bit_rate=${opt.bitRateMbps * 1_000_000}")
            add("max_size=${opt.maxSize}"); add("max_fps=${opt.maxFps}")
            if (opt.audio) { add("audio=true"); add("audio_codec=raw") } else add("audio=false")
            add("send_device_meta=true"); add("send_frame_meta=true"); add("send_dummy_byte=true"); add("send_codec_meta=true")
        }
        server = ProcessBuilder(listOf(adb.exe, "-s", serial, "shell") + args).redirectErrorStream(true).start().also { p ->
            daemon("phone-server-log") { p.inputStream.bufferedReader().forEachLine { l -> serverLog(l) } }
        }
        // The server needs a moment to listen; until then adb accepts and closes the connection at once.
        val v = connect(first = true)
        videoSock = v
        val vin = DataInputStream(v.getInputStream().buffered(1 shl 20))
        deviceName = String(vin.readNBytes(64), Charsets.UTF_8).trimEnd('\u0000')
        events.onDeviceName(deviceName)
        if (opt.audio) audioSock = connect(first = false)
        daemon("phone-video") { readVideo(vin) }
        audioSock?.let { a -> daemon("phone-audio") { readAudio(DataInputStream(a.getInputStream().buffered(1 shl 16))) } }
    }

    /** The phone-side server's own lines; its errors explain a failed start better than a closed socket. */
    private fun serverLog(l: String) { if (l.contains("ERROR") || l.contains("Exception")) lastServerError = l.trim() }
    @Volatile private var lastServerError: String? = null

    private fun connect(first: Boolean): Socket {
        var lastErr: Exception? = null
        repeat(100) {
            if (!running) throw IOException("stopped")
            try {
                val s = Socket()
                s.tcpNoDelay = true
                s.receiveBufferSize = 4 shl 20
                s.connect(InetSocketAddress("127.0.0.1", port), 2000)
                if (first) {
                    // the dummy byte: the server is really there (EOF = not yet listening)
                    if (s.getInputStream().read() < 0) { s.close(); throw EOFException("not ready") }
                }
                return s
            } catch (e: Exception) { lastErr = e; Thread.sleep(100) }
        }
        fail("the phone did not answer: ${lastServerError ?: lastErr?.message}")
    }

    private fun readVideo(i: DataInputStream) {
        var err: String? = null
        try {
            val codecId = i.readInt()
            videoCodec = codecName(codecId)
            width = i.readInt(); height = i.readInt()
            events.onVideoFormat(videoCodec, width, height)
            while (running) {
                val pts = i.readLong(); val size = i.readInt()
                if (size < 0 || size > MAX_PACKET) throw IOException("bad packet size $size")
                val data = ByteArray(size); i.readFully(data)
                val config = pts and FLAG_CONFIG != 0L
                val key = pts and FLAG_KEY != 0L
                events.onVideoPacket(data, if (config) -1 else pts and PTS_MASK, config, key)
            }
        } catch (e: Exception) {
            if (running) err = lastServerError ?: if (e is EOFException || e is java.net.SocketException)
                "اتصال با گوشی قطع شد (کابل جدا شد، یا گوشی قفل شد/برنامه را بست). دوباره «وصل شو» را بزن."
            else (e.message ?: e.javaClass.simpleName)
        }
        // always told, on this thread, after its last packet: whoever decodes can close its decoder safely here
        stop()
        events.onEnded(err)
    }

    private fun readAudio(i: DataInputStream) {
        try {
            val codecId = i.readInt()
            // 0: the phone cannot give its sound (Android < 11, or another app holds it); 1: an error there
            if (codecId == 0 || codecId == 1) { events.onAudioUnavailable(if (codecId == 0) "disabled" else "error"); return }
            if (codecId != CODEC_RAW) { events.onAudioUnavailable("codec ${codecName(codecId)}"); return }
            while (running) {
                val pts = i.readLong(); val size = i.readInt()
                if (size < 0 || size > MAX_PACKET) throw IOException("bad audio size $size")
                val data = ByteArray(size); i.readFully(data)
                if (pts and FLAG_CONFIG == 0L) events.onAudioPacket(data, pts and PTS_MASK)
            }
        } catch (e: Exception) { if (running) events.onAudioUnavailable(e.message ?: "ended") }
    }

    fun stop() {
        if (!running) return
        running = false
        try { videoSock?.close() } catch (_: Exception) {}
        try { audioSock?.close() } catch (_: Exception) {}
        try { server?.destroy() } catch (_: Exception) {}
        if (port != 0) try { adb.run("-s", serial, "forward", "--remove", "tcp:$port", timeoutMs = 5000) } catch (_: Exception) {}
    }

    private fun fail(msg: String): Nothing { stop(); throw IOException(msg) }

    private fun daemon(name: String, body: () -> Unit) {
        threads += Thread(body, name).apply { isDaemon = true; priority = Thread.MAX_PRIORITY; start() }
    }

    companion object {
        const val REMOTE = "/data/local/tmp/scrcpy-server.jar"
        private const val FLAG_CONFIG = 1L shl 63
        private const val FLAG_KEY = 1L shl 62
        private const val PTS_MASK = (1L shl 62) - 1
        private const val MAX_PACKET = 64 shl 20
        const val CODEC_H264 = 0x68323634
        const val CODEC_H265 = 0x68323635
        const val CODEC_AV1 = 0x00617631
        const val CODEC_RAW = 0x00726177

        fun codecName(id: Int) = when (id) { CODEC_H264 -> "h264"; CODEC_H265 -> "hevc"; CODEC_AV1 -> "av1"; else -> String.format("0x%08x", id) }

        fun freePort(): Int = ServerSocket(0).use { it.localPort }

        /** For tests: the same packet framing, written. */
        fun frame(pts: Long, config: Boolean, key: Boolean, data: ByteArray): ByteArray {
            val b = java.nio.ByteBuffer.allocate(12 + data.size)
            var p = pts
            if (config) p = p or FLAG_CONFIG
            if (key) p = p or FLAG_KEY
            b.putLong(p).putInt(data.size).put(data)
            return b.array()
        }
    }
}
