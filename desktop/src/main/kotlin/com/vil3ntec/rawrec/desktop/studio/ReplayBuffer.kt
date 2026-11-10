package com.vil3ntec.rawrec.desktop.studio

import com.vil3ntec.rawrec.desktop.*
import org.bytedeco.ffmpeg.avcodec.AVPacket
import org.bytedeco.ffmpeg.global.avcodec.*
import java.io.File
import java.nio.ByteBuffer
import java.text.SimpleDateFormat
import java.util.Date
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * Instant replay, as OBS's replay buffer: the program is encoded all the time and the last [seconds]
 * are kept in memory (whole groups of pictures, starting at a key frame); «save» writes them to a file
 * at once, while the buffer goes on. Nothing touches the disk until then.
 */
class ReplayBuffer(
    private val encoder: Encoders.Encoder, private val width: Int, private val height: Int, private val fps: Int,
    private val kbps: Int, val seconds: Int, private val dir: File = AppPaths.videos,
) : Output {
    private class Pkt(val video: Boolean, val data: ByteArray, val pts: Long, val dts: Long, val key: Boolean)
    private val free = ArrayBlockingQueue<ByteBuffer>(3)
    private val queue = ArrayBlockingQueue<Triple<ByteBuffer?, Long, ByteArray?>>(64)
    private val kept = ArrayDeque<Pkt>()
    private val lock = Any()
    @Volatile private var running = true
    @Volatile var dropped = 0L; private set
    @Volatile var error: String? = null; private set
    @Volatile private var firstUs = Long.MIN_VALUE
    private var allocated = 0
    private var venc: VideoEncoder? = null
    private var aenc: AudioEncoder? = null
    /** Seconds held right now (it fills up over the first [seconds]). */
    val heldSeconds: Double get() = synchronized(lock) {
        val v = kept.filter { it.video }; if (v.size < 2) 0.0 else (v.last().pts - v.first().pts) / 1000.0
    }

    private val thread = Thread({ loop() }, "replay-buffer").apply { isDaemon = true; start() }

    override fun video(f: VideoFrame) {
        if (!running) return
        if (firstUs == Long.MIN_VALUE) firstUs = f.ptsUs
        val need = f.width * f.height * 4
        var b = free.poll()
        if (b == null || b.capacity() < need) {
            if (b == null && allocated >= 3) { dropped++; return }
            if (b == null) allocated++
            b = ByteBuffer.allocateDirect(need)
        }
        b!!.clear(); val src = f.bgra.duplicate(); src.clear(); src.limit(need); b.put(src); b.flip()
        if (!queue.offer(Triple(b, f.ptsUs, null))) { free.offer(b); dropped++ }
    }

    override fun audio(pcm: ByteArray, ptsUs: Long) {
        if (!running || firstUs == Long.MIN_VALUE || ptsUs < firstUs) return
        queue.offer(Triple(null, ptsUs, pcm.copyOf()))
    }

    private fun loop() {
        try {
            val v = VideoEncoder(encoder, width, height, fps, kbps, globalHeader = true, quality = false); venc = v
            val a = AudioEncoder(192); aenc = a
            while (running) {
                val (buf, pts, pcm) = queue.poll(100, TimeUnit.MILLISECONDS) ?: continue
                if (pcm != null) { a.encodePcm(pcm, (pts - firstUs) * AudioEncoder.RATE / 1_000_000) { p -> keep(false, p) }; continue }
                try { v.encode(VideoFrame(width, height, buf!!, pts), (pts - firstUs) / 1000) { p -> keep(true, p) } } finally { free.offer(buf!!) }
            }
        } catch (t: Throwable) { error = t.message ?: t.javaClass.simpleName }
    }

    private fun keep(video: Boolean, p: AVPacket) {
        val d = ByteArray(p.size()); p.data().get(d)
        val pk = Pkt(video, d, p.pts(), p.dts(), p.flags() and AV_PKT_FLAG_KEY != 0)
        synchronized(lock) {
            kept.addLast(pk)
            // keep [seconds], cut at the first key frame after the limit (the file must start with a whole picture)
            val newest = if (video) pk.pts else kept.lastOrNull { it.video }?.pts ?: return
            while (true) {
                val firstKey = kept.indexOfFirst { it.video && it.key }
                val nextKey = kept.withIndex().firstOrNull { (i, x) -> i > firstKey && x.video && x.key }?.index ?: break
                if (newest - kept[nextKey].pts < seconds * 1000L) break
                repeat(nextKey) { kept.removeFirst() }
            }
        }
    }

    /** The last [seconds] into a new MP4; the buffer goes on. */
    fun save(): File? {
        val v = venc ?: return null; val a = aenc ?: return null
        val list = synchronized(lock) {
            val i = kept.indexOfFirst { it.video && it.key }
            if (i < 0) return null
            kept.toList().drop(i)
        }
        val v0 = list.first { it.video }.pts
        val a0 = v0 * AudioEncoder.RATE / 1000
        val mkv = File(dir, "RawRec Replay ${SimpleDateFormat("yyyy-MM-dd HH-mm-ss").format(Date())}.mkv")
        try {
            FileWriter(mkv, v.ctx, a.ctx).use { w ->
                val p = av_packet_alloc()
                try {
                    for (x in list) {
                        if (!x.video && x.pts < a0) continue
                        av_new_packet(p, x.data.size); p.data().put(x.data, 0, x.data.size)
                        val base = if (x.video) v0 else a0
                        p.pts(x.pts - base); p.dts(x.dts - base); p.flags(if (x.key) AV_PKT_FLAG_KEY else 0)
                        if (x.video) w.writeVideo(p) else w.writeAudio(p)
                        av_packet_unref(p)
                    }
                } finally { av_packet_free(p) }
            }
            val mp4 = File(mkv.parentFile, mkv.nameWithoutExtension + ".mp4")
            return if (FileWriter.remux(mkv, mp4)) { mkv.delete(); mp4 } else mkv
        } catch (t: Throwable) { error = t.message; return null }
    }

    fun stop() {
        running = false; thread.join(3000)
        try { venc?.close() } catch (_: Throwable) {}
        try { aenc?.close() } catch (_: Throwable) {}
        synchronized(lock) { kept.clear() }
    }
}
