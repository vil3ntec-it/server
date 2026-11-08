package com.vil3ntec.rawrec

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.URI
import java.util.Random
import javax.net.ssl.SSLSocketFactory

/**
 * ══ RawRec's own RTMP / RTMPS publisher (پخشِ زنده) ══
 *
 * What YouTube, Twitch, Facebook, Kick, TikTok and most other platforms take from a streaming app:
 * RTMP (or RTMP over TLS) with H.264 video and AAC audio in FLV packets. Plain JVM code — tested on
 * the build machine against ffmpeg as the receiving server.
 *
 * One thread uses an instance: [connect], then [sendHeaders], then [sendVideo] / [sendAudio], then
 * [close]. A failed send throws IOException; the caller ([RtmpSink]) reconnects. A second thread
 * only reads what the server sends (acknowledgements, pings) so the connection never stalls.
 */
class RtmpPublisher(
    private val url: String,
    private val key: String,
    private val connectTimeoutMs: Int = 10_000,
    /** Tests only: another TLS setup (a self-signed local server) and no host-name check. */
    private val tlsFactory: SSLSocketFactory? = null,
    private val verifyHost: Boolean = true,
) {

    class Target(val tls: Boolean, val host: String, val port: Int, val app: String, val tcUrl: String, val streamName: String)

    companion object {
        private const val CHUNK = 4096

        /** «rtmp[s]://host[:port]/app[/more]» + key → where to connect and what to publish. */
        fun parse(url: String, key: String): Target {
            val u = URI(url.trim().trimEnd('/'))
            val tls = when (u.scheme?.lowercase()) {
                "rtmps" -> true
                "rtmp" -> false
                else -> throw IOException("not an rtmp:// or rtmps:// address")
            }
            val host = u.host ?: throw IOException("no host in the server address")
            val port = if (u.port > 0) u.port else if (tls) 443 else 1935
            var path = (u.rawPath ?: "").trim('/')
            var name = key.trim()
            if (path.isEmpty()) throw IOException("no application in the server address")
            // Keys pasted with their path (Facebook gives «…/rtmp/FB-123?s_bl=…»): split the last part off.
            if (name.isEmpty() && path.contains('/')) { name = path.substringAfterLast('/'); path = path.substringBeforeLast('/') }
            val query = u.rawQuery?.let { "?$it" } ?: ""
            val tc = "${u.scheme}://$host${if (u.port > 0) ":${u.port}" else ""}/$path"
            return Target(tls, host, port, path, tc, name + query)
        }
    }

    private val target = parse(url, key)
    private var socket: Socket? = null
    private lateinit var out: OutputStream
    private var reader: Thread? = null
    @Volatile var closed = false; private set
    @Volatile private var readError: IOException? = null
    private var streamId = 1
    private var txn = 1.0
    private val lock = Object()
    private val responses = ArrayList<List<Any?>>()
    private var serverWindow = 2_500_000L
    @Volatile private var received = 0L
    private var ackedAt = 0L
    /** Bytes put on the wire so far (for the stream's bit-rate display). */
    @Volatile var bytesSent = 0L; private set

    // ------------------------------------------------------------ connect

    /** Handshake, connect, createStream, publish. Throws IOException with the server's reason. */
    fun connect() {
        val raw = Socket()
        raw.tcpNoDelay = true
        raw.sendBufferSize = 1 shl 20
        raw.connect(InetSocketAddress(target.host, target.port), connectTimeoutMs)
        val s: Socket = if (target.tls) {
            // RTMPS: TLS over the connection, with the platform's name checked against its certificate
            // (SSLSocket itself does not check it) — the stream key never goes to anyone else.
            val f = tlsFactory ?: (SSLSocketFactory.getDefault() as SSLSocketFactory)
            val ssl = f.createSocket(raw, target.host, target.port, true) as javax.net.ssl.SSLSocket
            ssl.soTimeout = connectTimeoutMs
            ssl.startHandshake()
            if (verifyHost && !javax.net.ssl.HttpsURLConnection.getDefaultHostnameVerifier().verify(target.host, ssl.session)) {
                ssl.close()
                throw IOException("the server's certificate is not for ${target.host}")
            }
            ssl
        } else raw
        s.soTimeout = 0
        socket = s
        out = BufferedOutputStream(s.getOutputStream(), 64 * 1024)
        val inp = DataInputStream(BufferedInputStream(s.getInputStream(), 64 * 1024))
        handshake(inp)
        reader = Thread({ readLoop(inp) }, "rawrec-rtmp-read").apply { isDaemon = true; start() }

        setChunkSize()
        command(3, 0, "connect", txn++, linkedMapOf(
            "app" to target.app, "type" to "nonprivate", "flashVer" to "FMLE/3.0 (compatible; RawRec)",
            "tcUrl" to target.tcUrl, "swfUrl" to target.tcUrl,
        ))
        awaitResult("connect")
        command(3, 0, "releaseStream", txn++, null, target.streamName)
        command(3, 0, "FCPublish", txn++, null, target.streamName)
        val create = txn++
        command(3, 0, "createStream", create, null)
        val r = awaitResult("createStream", create)
        streamId = ((r.getOrNull(3) as? Double) ?: 1.0).toInt()
        command(4, streamId, "publish", 0.0, null, target.streamName, "live")
        awaitStatus("NetStream.Publish.Start")
    }

    private fun handshake(inp: DataInputStream) {
        val c1 = ByteArray(1536)
        Random().nextBytes(c1)
        for (i in 0 until 8) c1[i] = 0
        out.write(3); out.write(c1); out.flush()   // before the reader thread exists
        val s0 = inp.readUnsignedByte()
        if (s0 != 3) throw IOException("server did not answer as RTMP")
        val s1 = ByteArray(1536); inp.readFully(s1)
        val s2 = ByteArray(1536); inp.readFully(s2)
        out.write(s1); out.flush()   // C2 = S1
        received += 1 + 1536 * 2
    }

    // ------------------------------------------------------------ media

    /** FLV onMetaData + the AVC and AAC configuration records. [asc] null = no audio. */
    fun sendHeaders(width: Int, height: Int, fps: Int, videoKbps: Int, avcConfig: ByteArray, asc: ByteArray?, sampleRate: Int, channels: Int) {
        val meta = Amf0.write("@setDataFrame", "onMetaData", linkedMapOf<String, Any?>(
            "width" to width.toDouble(), "height" to height.toDouble(), "framerate" to fps.toDouble(),
            "videocodecid" to 7.0, "videodatarate" to videoKbps.toDouble(),
            "audiocodecid" to (if (asc != null) 10.0 else null), "audiosamplerate" to sampleRate.toDouble(),
            "audiochannels" to channels.toDouble(), "stereo" to (channels > 1), "encoder" to "RawRec",
        ).filterValues { it != null })
        message(5, 18, streamId, 0, meta)
        sendVideoConfig(avcConfig)
        if (asc != null) sendAudioConfig(asc)
    }

    fun sendVideoConfig(avcConfig: ByteArray) {
        val b = ByteArray(5 + avcConfig.size)
        b[0] = 0x17; b[1] = 0
        System.arraycopy(avcConfig, 0, b, 5, avcConfig.size)
        message(6, 9, streamId, 0, b)
    }

    fun sendAudioConfig(asc: ByteArray) {
        val b = ByteArray(2 + asc.size)
        b[0] = 0xAF.toByte(); b[1] = 0
        System.arraycopy(asc, 0, b, 2, asc.size)
        message(4, 8, streamId, 0, b)
    }

    /** One access unit, NAL units already length-prefixed (4 bytes). */
    fun sendVideo(timeMs: Long, key: Boolean, avcc: ByteArray, off: Int, len: Int) {
        val b = ByteArray(5 + len)
        b[0] = if (key) 0x17 else 0x27
        b[1] = 1
        System.arraycopy(avcc, off, b, 5, len)
        message(6, 9, streamId, timeMs, b)
    }

    /** One raw AAC frame. */
    fun sendAudio(timeMs: Long, aac: ByteArray, off: Int, len: Int) {
        val b = ByteArray(2 + len)
        b[0] = 0xAF.toByte(); b[1] = 1
        System.arraycopy(aac, off, b, 2, len)
        message(4, 8, streamId, timeMs, b)
    }

    fun flush() { checkRead(); synchronized(this) { out.flush() } }

    /** Ends the stream politely (the platform shows «stream ended» at once), then closes. */
    fun close() {
        if (closed) return
        try {
            command(4, streamId, "FCUnpublish", txn++, null, target.streamName)
            command(3, 0, "deleteStream", txn++, null, streamId.toDouble())
            out.flush()
        } catch (_: Exception) {}
        closed = true
        try { socket?.close() } catch (_: Exception) {}
        reader?.interrupt()
    }

    // ------------------------------------------------------------ chunk stream

    private fun setChunkSize() {
        val b = byteArrayOf(0, 0, (CHUNK shr 8).toByte(), CHUNK.toByte())
        writeChunks(2, 1, 0, 0, b, 128)
        outChunk = CHUNK   // from now on the server reads chunks of this size
    }

    private var outChunk = 128

    private fun command(csid: Int, msid: Int, name: String, txn: Double, obj: Map<String, Any?>?, vararg args: Any?) {
        message(csid, 20, msid, 0, Amf0.write(name, txn, obj, *args))
    }

    private fun message(csid: Int, type: Int, msid: Int, timeMs: Long, payload: ByteArray) {
        checkRead()
        writeChunks(csid, type, msid, timeMs, payload, outChunk)
        if (type == 1) outChunk = CHUNK
    }

    // The reader thread answers pings and sends acknowledgements: every write goes under this lock.
    @Synchronized
    private fun writeChunks(csid: Int, type: Int, msid: Int, timeMs: Long, p: ByteArray, size: Int) {
        val ts = timeMs and 0xFFFFFFFFL
        val ext = ts >= 0xFFFFFF
        val h = ByteArrayOutputStream(18)
        h.write(csid and 0x3F)                       // fmt 0
        val t3 = if (ext) 0xFFFFFF else ts.toInt()
        h.write(t3 shr 16); h.write(t3 shr 8); h.write(t3)
        h.write(p.size shr 16); h.write(p.size shr 8); h.write(p.size)
        h.write(type)
        h.write(msid); h.write(msid shr 8); h.write(msid shr 16); h.write(msid shr 24)   // little endian
        if (ext) { h.write((ts shr 24).toInt()); h.write((ts shr 16).toInt()); h.write((ts shr 8).toInt()); h.write(ts.toInt()) }
        val hb = h.toByteArray()
        out.write(hb)
        var pos = 0
        var n = 0
        while (pos < p.size) {
            if (pos > 0) {
                out.write(0xC0 or (csid and 0x3F))   // fmt 3
                if (ext) { out.write((ts shr 24).toInt()); out.write((ts shr 16).toInt()); out.write((ts shr 8).toInt()); out.write(ts.toInt()) }
                n += if (ext) 5 else 1
            }
            val len = minOf(size, p.size - pos)
            out.write(p, pos, len)
            pos += len
        }
        bytesSent += hb.size + p.size + n
    }

    // ------------------------------------------------------------ reading

    private class InChunk(var type: Int = 0, var msid: Int = 0, var len: Int = 0, var ts: Long = 0, var buf: ByteArrayOutputStream? = null)

    private fun readLoop(inp: DataInputStream) {
        val chunks = HashMap<Int, InChunk>()
        var inChunk = 128
        try {
            while (!closed) {
                val b0 = inp.readUnsignedByte()
                val fmt = b0 shr 6
                var csid = b0 and 0x3F
                if (csid == 0) csid = 64 + inp.readUnsignedByte()
                else if (csid == 1) csid = 64 + inp.readUnsignedByte() + inp.readUnsignedByte() * 256
                val c = chunks.getOrPut(csid) { InChunk() }
                var hdr = 1
                if (fmt <= 2) {
                    var t = (inp.readUnsignedByte() shl 16) or (inp.readUnsignedByte() shl 8) or inp.readUnsignedByte()
                    hdr += 3
                    if (fmt <= 1) {
                        c.len = (inp.readUnsignedByte() shl 16) or (inp.readUnsignedByte() shl 8) or inp.readUnsignedByte()
                        c.type = inp.readUnsignedByte()
                        hdr += 4
                    }
                    if (fmt == 0) {
                        c.msid = inp.readUnsignedByte() or (inp.readUnsignedByte() shl 8) or (inp.readUnsignedByte() shl 16) or (inp.readUnsignedByte() shl 24)
                        hdr += 4
                    }
                    if (t == 0xFFFFFF) { t = inp.readInt(); hdr += 4 }
                    c.ts = t.toLong()
                }
                if (c.buf == null) c.buf = ByteArrayOutputStream(c.len)
                val buf = c.buf!!
                val want = minOf(inChunk, c.len - buf.size())
                val tmp = ByteArray(want)
                inp.readFully(tmp)
                buf.write(tmp)
                received += hdr + want
                if (buf.size() >= c.len) {
                    val payload = buf.toByteArray()
                    c.buf = null
                    when (c.type) {
                        1 -> inChunk = ((payload[0].toInt() and 0x7F) shl 24) or ((payload[1].toInt() and 0xFF) shl 16) or
                            ((payload[2].toInt() and 0xFF) shl 8) or (payload[3].toInt() and 0xFF)
                        5 -> serverWindow = be32(payload).toLong()
                        4 -> if (payload.size >= 6 && be16(payload) == 6) {   // ping request → pong
                            val pong = byteArrayOf(0, 7, payload[2], payload[3], payload[4], payload[5])
                            try { synchronized(this) { writeChunks(2, 4, 0, 0, pong, outChunk); out.flush() } } catch (_: Exception) {}
                        }
                        20 -> synchronized(lock) { responses += Amf0.read(payload); lock.notifyAll() }
                    }
                    if (received - ackedAt > serverWindow / 2) {
                        ackedAt = received
                        val a = byteArrayOf((received shr 24).toByte(), (received shr 16).toByte(), (received shr 8).toByte(), received.toByte())
                        try { writeChunks(2, 3, 0, 0, a, outChunk) } catch (_: Exception) {}
                    }
                }
            }
        } catch (e: IOException) {
            if (!closed) { readError = e; synchronized(lock) { lock.notifyAll() } }
        } catch (e: Exception) {
            if (!closed) { readError = IOException(e.message ?: "read error", e); synchronized(lock) { lock.notifyAll() } }
        }
    }

    private fun checkRead() { readError?.let { throw it } }

    private fun awaitResult(what: String, id: Double? = null): List<Any?> {
        synchronized(this) { out.flush() }
        val end = System.currentTimeMillis() + 10_000
        synchronized(lock) {
            while (true) {
                checkRead()
                val i = responses.indexOfFirst { r ->
                    val n = r.getOrNull(0)
                    (n == "_result" || n == "_error") && (id == null || r.getOrNull(1) == id)
                }
                if (i >= 0) {
                    val r = responses.removeAt(i)
                    if (r[0] == "_error") throw IOException("$what refused: " + describe(r))
                    return r
                }
                val left = end - System.currentTimeMillis()
                if (left <= 0) throw IOException("$what: no answer from the server" + (if (responses.isEmpty()) "" else " (got: ${responses.map { it.take(2) }})"))
                lock.wait(left)
            }
        }
    }

    private fun awaitStatus(code: String) {
        synchronized(this) { out.flush() }
        val end = System.currentTimeMillis() + 10_000
        synchronized(lock) {
            while (true) {
                checkRead()
                val i = responses.indexOfFirst { it.getOrNull(0) == "onStatus" }
                if (i >= 0) {
                    val r = responses.removeAt(i)
                    val info = r.getOrNull(3) as? Map<*, *>
                    val c = info?.get("code") as? String
                    if (c == code) return
                    if (info?.get("level") == "error") throw IOException("publish refused: ${c ?: ""} ${info["description"] ?: ""}".trim())
                    continue
                }
                val left = end - System.currentTimeMillis()
                if (left <= 0) throw IOException("publish: no answer from the server (wrong stream key?)")
                lock.wait(left)
            }
        }
    }

    private fun describe(r: List<Any?>): String {
        val info = r.drop(2).firstOrNull { it is Map<*, *> } as? Map<*, *>
        return listOfNotNull(info?.get("code"), info?.get("description")).joinToString(" ").ifEmpty { r.toString() }
    }

    private fun be32(b: ByteArray) = ((b[0].toInt() and 0xFF) shl 24) or ((b[1].toInt() and 0xFF) shl 16) or ((b[2].toInt() and 0xFF) shl 8) or (b[3].toInt() and 0xFF)
    private fun be16(b: ByteArray) = ((b[0].toInt() and 0xFF) shl 8) or (b[1].toInt() and 0xFF)
}

/** The small part of AMF0 that RTMP commands use. */
object Amf0 {
    fun write(vararg values: Any?): ByteArray {
        val o = ByteArrayOutputStream()
        for (v in values) value(o, v)
        return o.toByteArray()
    }

    private fun value(o: ByteArrayOutputStream, v: Any?) {
        when (v) {
            null -> o.write(5)
            is Boolean -> { o.write(1); o.write(if (v) 1 else 0) }
            is Number -> { o.write(0); val l = java.lang.Double.doubleToLongBits(v.toDouble()); for (i in 7 downTo 0) o.write((l shr (8 * i)).toInt()) }
            is String -> { o.write(2); str(o, v) }
            is Map<*, *> -> {
                o.write(3)
                for ((k, x) in v) { str(o, k.toString()); value(o, x) }
                o.write(0); o.write(0); o.write(9)
            }
            else -> { o.write(2); str(o, v.toString()) }
        }
    }

    private fun str(o: ByteArrayOutputStream, s: String) {
        val b = s.toByteArray(Charsets.UTF_8)
        o.write(b.size shr 8); o.write(b.size); o.write(b)
    }

    fun read(b: ByteArray): List<Any?> {
        val out = ArrayList<Any?>()
        val p = intArrayOf(0)
        try { while (p[0] < b.size) out += value(b, p) } catch (_: Exception) {}
        return out
    }

    private fun value(b: ByteArray, p: IntArray): Any? {
        val t = b[p[0]++].toInt() and 0xFF
        return when (t) {
            0 -> { var l = 0L; for (i in 0 until 8) l = (l shl 8) or (b[p[0]++].toLong() and 0xFF); java.lang.Double.longBitsToDouble(l) }
            1 -> b[p[0]++].toInt() != 0
            2 -> str(b, p)
            3 -> obj(b, p)
            5, 6 -> null
            8 -> { p[0] += 4; obj(b, p) }
            10 -> { val n = ((b[p[0]].toInt() and 0xFF) shl 24) or ((b[p[0] + 1].toInt() and 0xFF) shl 16) or ((b[p[0] + 2].toInt() and 0xFF) shl 8) or (b[p[0] + 3].toInt() and 0xFF); p[0] += 4; List(n) { value(b, p) } }
            else -> throw IllegalStateException("amf0 type $t")
        }
    }

    private fun str(b: ByteArray, p: IntArray): String {
        val n = ((b[p[0]].toInt() and 0xFF) shl 8) or (b[p[0] + 1].toInt() and 0xFF)
        p[0] += 2
        val s = String(b, p[0], n, Charsets.UTF_8)
        p[0] += n
        return s
    }

    private fun obj(b: ByteArray, p: IntArray): Map<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        while (true) {
            val k = str(b, p)
            if (k.isEmpty() && (b[p[0]].toInt() and 0xFF) == 9) { p[0]++; return m }
            m[k] = value(b, p)
        }
    }
}
