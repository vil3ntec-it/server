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
 *
 * The file is at exactly the chosen frame rate, on the phone's clock (the sound's clock too): the phone
 * sends a picture only when its screen changes, so a still screen is filled with the last picture,
 * and a phone faster than the file gives one picture per frame. The file lasts as long as the recording.
 */
class Recording(
    private val encoder: Encoders.Encoder,
    private val height: Int,
    private val fps: Int,
    private val bitrateKbps: Int,
    private val withAudio: Boolean,
    dir: File = AppPaths.videos,
    /** Added to the file name ("vertical" → «RawRec … vertical.mp4»). */
    suffix: String = "",
) {
    class Result(val file: File, val seconds: Double, val frames: Long, val dropped: Long, val bytes: Long, val encoder: String, val width: Int, val height: Int, val error: String?)

    private val stamp = SimpleDateFormat("yyyy-MM-dd HH-mm-ss").format(Date())
    private val mkv = File(dir, "RawRec $stamp${if (suffix.isNotEmpty()) " $suffix" else ""}.mkv")
    private val free = ArrayBlockingQueue<ByteBuffer>(POOL)
    private val queue = ArrayBlockingQueue<Item>(POOL + 64)
    private class Item(val buf: ByteBuffer?, val w: Int, val h: Int, val ptsUs: Long, val pcm: ByteArray?, val atNs: Long = 0)
    private var thread: Thread? = null
    @Volatile private var running = false
    @Volatile private var baseUs = Long.MIN_VALUE
    @Volatile var dropped = 0L; private set
    @Volatile var error: String? = null; private set
    private var venc: VideoEncoder? = null
    private var aenc: AudioEncoder? = null
    private var writer: FileWriter? = null
    private var lastMs = -1L
    private var nextSlot = 0L                 // the next frame of the file to fill
    private var haveFrame = false
    private var anchorUs = 0L                 // the newest picture, on the phone's clock (from the first)…
    private var anchorNs = 0L                 // …and when it came, on this computer's clock
    @Volatile private var stopNs = 0L
    private val waiting = java.util.concurrent.atomic.AtomicInteger()   // pictures in the queue
    @Volatile private var firstNs = 0L      // when the first picture came (this computer's clock)
    // pause: nothing is taken while paused, and the time it lasted is taken out, so the file has no gap
    @Volatile var paused = false; private set
    @Volatile private var pauseAtUs = Long.MIN_VALUE
    @Volatile private var pauseAtNs = 0L
    @Volatile private var offsetUs = 0L
    @Volatile private var pausedNs = 0L
    @Volatile private var holdFill = false
    @Volatile private var lastInUs = 0L
    fun pause() { if (!paused) { pauseAtUs = lastInUs; pauseAtNs = System.nanoTime(); paused = true } }
    fun resume() { if (paused) { pausedNs += System.nanoTime() - pauseAtNs; holdFill = true; resumeWanted = true; paused = false } }
    @Volatile private var resumeWanted = false
    private var wallClock = false           // the phone's picture clock proved wrong: arrival times instead
    private var audioShift: Long? = null    // sound's phone µs → the file's µs
    private var outW = 0
    @Volatile var startedAtMs = 0L; private set

    val file get() = mkv
    val bytes get() = writer?.bytes ?: 0L

    fun start() {
        Awake.keep()
        running = true
        startedAtMs = System.currentTimeMillis()
        thread = Thread({ loop() }, "rawrec-record").apply { priority = Thread.MAX_PRIORITY - 1; start() }
    }

    /** A picture (copied now; the caller's buffer may be reused at once). */
    fun video(f0: VideoFrame) {
        if (!running) return
        if (paused) return
        if (resumeWanted) { resumeWanted = false; offsetUs += (f0.ptsUs - pauseAtUs) - (1_000_000L / fps) }
        lastInUs = f0.ptsUs
        val f = if (offsetUs == 0L) f0 else VideoFrame(f0.width, f0.height, f0.bgra, f0.ptsUs - offsetUs)
        if (baseUs == Long.MIN_VALUE) { firstNs = System.nanoTime(); baseUs = f.ptsUs }
        val need = f.width * f.height * 4
        var b = free.poll()
        if (b == null || b.capacity() < need) {
            b = if (b == null && allocated >= POOL) { dropped++; return } else { if (b == null) allocated++; ByteBuffer.allocateDirect(need) }
        }
        b!!.clear()
        val src = f.bgra.duplicate(); src.clear(); src.limit(need)
        b.put(src); b.flip()
        waiting.incrementAndGet()
        if (!queue.offer(Item(b, f.width, f.height, f.ptsUs, null, System.nanoTime() - pausedNs))) { waiting.decrementAndGet(); free.offer(b); dropped++ }
    }
    private var allocated = 0

    /** The phone's sound (16-bit PCM, 48 kHz, stereo) at [ptsUs] on the phone's clock (the same as the pictures'). */
    fun audio(pcm: ByteArray, ptsUs: Long) {
        if (!running || !withAudio || baseUs == Long.MIN_VALUE || paused || resumeWanted) return
        queue.offer(Item(null, 0, 0, ptsUs - offsetUs, pcm, System.nanoTime() - pausedNs))
    }

    private fun loop() {
        try {
            while (running || queue.isNotEmpty()) {
                val it = queue.poll(1000L / fps, TimeUnit.MILLISECONDS)
                if (it != null) {
                    if (it.pcm != null) audioItem(it)
                    else try { videoItem(it) } finally { free.offer(it.buf!!); waiting.decrementAndGet() }
                }
                // a still screen: the last picture again, a little behind "now" so a late picture keeps its place
                // (only while no picture waits: a waiting one is newer and goes in its own frame)
                if (running && !paused && !holdFill && waiting.get() == 0) fillTo(phoneNowUs(System.nanoTime() - pausedNs) - LATE_US)
            }
            if (!paused) fillTo(phoneNowUs((if (stopNs != 0L) stopNs else System.nanoTime()) - pausedNs))   // the file lasts until «stop»
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
        // the phone's own stamps keep its exact timing; a phone whose picture clock does not run like a
        // real clock (an emulator: 3 s of stamps in 14 s) would give a short, jerky file — then arrival times
        val phoneT = it.ptsUs - baseUs
        val wallT = (it.atNs - firstNs) / 1000
        if (!wallClock && wallT > 1_500_000 && kotlin.math.abs(phoneT - wallT) > wallT / 5) wallClock = true
        val t = if (wallClock) wallT else phoneT
        holdFill = false
        if (t >= anchorUs || !haveFrame) { anchorUs = t; anchorNs = it.atNs }
        val slot = (t * fps + 500_000) / 1_000_000
        if (slot < nextSlot) return                     // this frame of the file already has its picture
        fillTo(slot - 1, inSlots = true)
        val ms = slotMs(slot)
        venc!!.encode(VideoFrame(it.w, it.h, it.buf!!, it.ptsUs), ms) { p -> writer!!.writeVideo(p) }
        lastMs = ms; nextSlot = slot + 1; haveFrame = true
    }

    private fun slotMs(slot: Long) = slot * 1000 / fps
    private fun phoneNowUs(ns: Long) = anchorUs + (ns - anchorNs) / 1000

    /** The last picture again for every frame of the file up to [to] (phone µs, or a frame number). */
    private fun fillTo(to: Long, inSlots: Boolean = false) {
        val v = venc ?: return
        if (!haveFrame) return
        val last = if (inSlots) to else to * fps / 1_000_000
        while (nextSlot <= last) {
            val ms = slotMs(nextSlot)
            v.repeat(ms) { p -> writer!!.writeVideo(p) }
            lastMs = ms; nextSlot++
        }
    }

    private fun audioItem(it: Item) {
        val a = aenc ?: return   // the sound starts with the first picture
        // the phone's clock when it agrees with when the sound came (it does on phones), else arrival times
        val shift = audioShift ?: run {
            val byPhone = it.ptsUs - baseUs
            val byArrival = (it.atNs - firstNs) / 1000
            (if (kotlin.math.abs(byPhone - byArrival) <= 300_000) -baseUs else byArrival - it.ptsUs).also { s -> audioShift = s }
        }
        val us = it.ptsUs + shift
        if (us < 0) return
        val at = us * AudioEncoder.RATE / 1_000_000
        a.encodePcm(it.pcm!!, at) { p -> writer?.writeAudio(p) }
    }

    /** Ends the recording: what waits is written, the file closed and copied into MP4. */
    fun stop(): Result {
        stopNs = System.nanoTime()
        running = false
        thread?.join(15_000)
        val frames = venc?.frames ?: 0
        val secs = if (lastMs < 0) 0.0 else (lastMs + 1000.0 / fps) / 1000.0
        var out = mkv
        if (error == null && mkv.length() > 0) {
            val mp4 = File(mkv.parentFile, mkv.nameWithoutExtension + ".mp4")
            if (FileWriter.remux(mkv, mp4)) { mkv.delete(); out = mp4 } else mp4.delete()
        }
        return Result(out, secs, frames, dropped, out.length(), encoder.name, outW, height, error)
    }

    companion object {
        private const val POOL = 6
        /** How long a picture may be late before its frame is filled with the one before it. */
        private const val LATE_US = 150_000L
    }
}
