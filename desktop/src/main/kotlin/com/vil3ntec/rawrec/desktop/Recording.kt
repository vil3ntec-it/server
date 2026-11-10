package com.vil3ntec.rawrec.desktop

import java.io.File
import java.nio.ByteBuffer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * A recording of the pictures and sound handed to it, on its own thread: the phone's stream is never
 * held up by the encoder. Pictures wait in a short queue; if the encoder cannot keep up a picture is
 * dropped (counted, said in the result) — never a growing delay. The picture's size is the chosen
 * height, its width the shape of the first picture (rounded to even).
 */
class Recording(
    private val encoder: Encoders.Encoder,
    private val height: Int,
    private val fps: Int,
    private val bitrateKbps: Int,
    private val withAudio: Boolean,
    dir: File = AppPaths.videos,
) {
    class Result(val file: File, val seconds: Double, val frames: Long, val dropped: Long, val bytes: Long, val encoder: String, val width: Int, val height: Int, val error: String?)

    private val stamp = SimpleDateFormat("yyyy-MM-dd HH-mm-ss").format(Date())
    private val mkv = File(dir, "RawRec $stamp.mkv")
    private val free = ArrayBlockingQueue<ByteBuffer>(POOL)
    private val queue = ArrayBlockingQueue<Item>(POOL + 64)
    private class Item(val buf: ByteBuffer?, val w: Int, val h: Int, val ptsUs: Long, val pcm: ByteArray?)
    private var thread: Thread? = null
    @Volatile private var running = false
    @Volatile private var baseUs = Long.MIN_VALUE
    @Volatile var dropped = 0L; private set
    @Volatile var error: String? = null; private set
    private var venc: VideoEncoder? = null
    private var aenc: AudioEncoder? = null
    private var writer: FileWriter? = null
    private var lastMs = -1L
    private var outW = 0
    @Volatile var startedAtMs = 0L; private set

    val file get() = mkv
    val bytes get() = writer?.bytes ?: 0L

    fun start() {
        running = true
        startedAtMs = System.currentTimeMillis()
        thread = Thread({ loop() }, "rawrec-record").apply { priority = Thread.MAX_PRIORITY - 1; start() }
    }

    /** A picture (copied now; the caller's buffer may be reused at once). */
    fun video(f: VideoFrame) {
        if (!running) return
        if (baseUs == Long.MIN_VALUE) baseUs = f.ptsUs
        val need = f.width * f.height * 4
        var b = free.poll()
        if (b == null || b.capacity() < need) {
            b = if (b == null && allocated >= POOL) { dropped++; return } else { if (b == null) allocated++; ByteBuffer.allocateDirect(need) }
        }
        b!!.clear()
        val src = f.bgra.duplicate(); src.clear(); src.limit(need)
        b.put(src); b.flip()
        if (!queue.offer(Item(b, f.width, f.height, f.ptsUs, null))) { free.offer(b); dropped++ }
    }
    private var allocated = 0

    /** The phone's sound (16-bit PCM, 48 kHz, stereo) at [ptsUs] on the phone's clock (the same as the pictures'). */
    fun audio(pcm: ByteArray, ptsUs: Long) {
        if (!running || !withAudio || baseUs == Long.MIN_VALUE || ptsUs < baseUs) return
        queue.offer(Item(null, 0, 0, ptsUs, pcm))
    }

    private fun loop() {
        try {
            while (running || queue.isNotEmpty()) {
                val it = queue.poll(100, TimeUnit.MILLISECONDS) ?: continue
                if (it.pcm != null) { audioItem(it); continue }
                try { videoItem(it) } finally { free.offer(it.buf!!) }
            }
            venc?.flush { p -> writer?.writeVideo(p) }
            aenc?.flush { p -> writer?.writeAudio(p) }
        } catch (t: Throwable) {
            error = t.message ?: t.javaClass.simpleName
            running = false
        } finally {
            try { writer?.close() } catch (_: Throwable) {}
            venc?.close(); aenc?.close()
        }
    }

    private fun videoItem(it: Item) {
        if (venc == null) {
            // the width from the first picture's shape, at the chosen height (both even)
            outW = ((height.toLong() * it.w / it.h).toInt() + 1) and 1.inv()
            val v = VideoEncoder(encoder, outW, height, fps, bitrateKbps, globalHeader = true, quality = true)
            val a = if (withAudio) AudioEncoder() else null
            venc = v; aenc = a
            writer = FileWriter(mkv, v.ctx, a?.ctx)
        }
        var ms = (it.ptsUs - baseUs) / 1000
        if (ms <= lastMs) ms = lastMs + 1
        lastMs = ms
        venc!!.encode(VideoFrame(it.w, it.h, it.buf!!, it.ptsUs), ms) { p -> writer!!.writeVideo(p) }
    }

    private fun audioItem(it: Item) {
        val a = aenc ?: return   // the sound starts with the first picture
        val at = (it.ptsUs - baseUs) * AudioEncoder.RATE / 1_000_000
        a.encodePcm(it.pcm!!, at) { p -> writer?.writeAudio(p) }
    }

    /** Ends the recording: what waits is written, the file closed and copied into MP4. */
    fun stop(): Result {
        running = false
        thread?.join(15_000)
        val frames = venc?.frames ?: 0
        val secs = lastMs.coerceAtLeast(0) / 1000.0
        var out = mkv
        if (error == null && mkv.length() > 0) {
            val mp4 = File(mkv.parentFile, mkv.nameWithoutExtension + ".mp4")
            if (FileWriter.remux(mkv, mp4)) { mkv.delete(); out = mp4 } else mp4.delete()
        }
        return Result(out, secs, frames, dropped, out.length(), encoder.name, outW, height, error)
    }

    companion object { private const val POOL = 6 }
}
