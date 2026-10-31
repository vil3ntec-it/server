package com.vil3ntec.rawrec

import android.content.ContentValues
import android.content.Context
import android.media.MediaCodec
import android.media.MediaFormat
import android.media.MediaMuxer
import android.net.Uri
import android.os.Environment
import android.os.Process
import android.provider.MediaStore
import java.nio.ByteBuffer
import java.util.ArrayDeque
import java.util.TreeMap
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Writes the encoders' compressed output into MP4 parts with no re-encoding.
 *
 * The encoder threads only copy each sample into a recycled buffer and queue it; one writer thread
 * owns MediaMuxer and MediaStore. So file I/O, opening a new part or a slow disk never blocks the
 * encoder drain (that stall was a cause of dropped frames in 1.0).
 *
 * A new part starts at a key frame when the current one passes [segLimit] bytes, when the video
 * size changes because the device rotated, or after a write error (the part so far is closed
 * cleanly instead of the whole recording ending). Every video frame lands in exactly one part, and
 * the previous part stays open for the audio of the moment before the switch, so the sound has no
 * gap either. Every part is finalized (MP4 index written) whatever ends the recording.
 */
class SegMuxer(
    private val sink: PartSink,
    hasAudio: Boolean,
    private val segLimit: Long,
    private val baseName: String,
    private val events: Events,
) {
    constructor(ctx: Context, hasAudio: Boolean, segLimit: Long, baseName: String, events: Events) :
        this(MediaStoreSink(ctx), hasAudio, segLimit, baseName, events)

    interface Events {
        fun onAudioGivenUp()
        fun onPartOpened(index: Int, reason: Int)
        /** Writing failed and could not be recovered: the recording has to end. */
        fun onWriteError(message: String)
        /** The part's file exists now (unplayable until [onPartFinished]): used to find leftovers after a process death. */
        fun onPartCreated(part: Part) {}
        fun onPartFinished(part: Part) {}
        /** Writing failed once: the part so far was closed cleanly and the next key frame starts a new part. */
        fun onWriteRecovered(message: String) {}
    }

    companion object {
        const val REASON_START = 0
        const val REASON_SIZE = 1
        const val REASON_ROTATE = 2
        const val REASON_RESTART = 3   // «شروعِ هوشمند»: the first seconds were discarded, one fresh file
        const val REASON_RECOVER = 4   // after a write error or an encoder that had to be replaced
        private const val K_VIDEO = 1
        private const val K_AUDIO = 2
        private const val K_VFMT = 3
        private const val K_AFMT = 4
        private const val K_NO_AUDIO = 5
        private const val K_FINISH = 6
        private const val K_NEW_PART = 7
        private const val K_RESTART = 8
        private const val K_REPLACED = 9
        private const val AUDIO_WAIT_NS = 2_000_000_000L
        private const val TAIL_NS = 1_500_000_000L
        private const val MAX_WRITE_RECOVERIES = 3
        private const val WRITE_RETRY_WINDOW_NS = 10_000_000_000L
        private const val POOL_BUDGET = 160L * 1024 * 1024
    }

    class Part(val index: Int, val uri: Uri, val name: String, val reason: Int) {
        @Volatile var bytes = 0L
        @Volatile var ok = false
        @Volatile var finished = false
    }

    private class Item {
        var kind = 0
        var buf: ByteBuffer? = null
        val info = MediaCodec.BufferInfo()
        var format: MediaFormat? = null
    }

    private class Seg(
        val part: Part,
        val file: PartFile,
        val vTrack: Int,
        val aTrack: Int,
        val base: Long,
        val vFormat: MediaFormat,
    ) {
        var bytes = 0L
        var lastA = -1L
        var wrote = false
        val closed = AtomicBoolean(false)
    }

    // ---- shared between producer threads and the writer ----
    private val queue = ArrayBlockingQueue<Item>(8192)
    private val items = ArrayBlockingQueue<Item>(8192)
    private val pool = BufferPool(POOL_BUDGET)
    private val keyWanted = AtomicBoolean(false)
    private val parts = TreeMap<Int, Part>()
    private val writer = Thread({ writerLoop() }, "rawrec-mux")
    @Volatile var waitNs = 0L; private set          // time encoder threads waited for a free buffer
    @Volatile var totalBytes = 0L; private set
    @Volatile var videoBytes = 0L; private set
    @Volatile var audioBytes = 0L; private set
    @Volatile var maxQueued = 0; private set
    @Volatile var writeRecoveries = 0; private set
    @Volatile private var finished = false

    // ---- writer-thread state ----
    private var audioWanted = hasAudio
    private var vFmt: MediaFormat? = null
    private var aFmt: MediaFormat? = null
    private var seg: Seg? = null
    private var tail: Seg? = null              // previous part, still taking the audio from before the switch
    private var tailUntilNs = 0L
    private var segIndex = 0
    private var forceReason = -1
    private var openReason = REASON_START      // reason for the next part when none is open
    private var awaitKey = false               // a replaced encoder: nothing is written before its key frame
    private var checkNextFormat = false
    private var lastWriteFailNs = 0L
    private var fatalSent = false
    private val pending = ArrayList<Item>()
    private var pendingSinceNs = 0L
    private val closers = ArrayList<Thread>()
    private val outInfo = MediaCodec.BufferInfo()

    init { writer.start() }

    // ------------------------------------------------------------ producer side (encoder threads)

    /** Queues one encoded video frame. @return true if the encoder should make the next frame a key frame. */
    fun submitVideo(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int): Boolean {
        submitSample(K_VIDEO, src, offset, size, ptsUs, flags)
        return keyWanted.getAndSet(false)
    }

    fun submitAudio(src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int) =
        submitSample(K_AUDIO, src, offset, size, ptsUs, flags)

    fun videoFormat(f: MediaFormat) = submitFormat(K_VFMT, f)
    fun audioFormat(f: MediaFormat) = submitFormat(K_AFMT, f)

    /**
     * The video encoder was replaced (rotation). Everything queued before this belongs to the old
     * encoder; the new encoder's first key frame opens a new part with the new size. With
     * [discardCurrent] («شروعِ هوشمند») the current part is deleted and the new one becomes the
     * single file.
     */
    fun newPart(discardCurrent: Boolean) = put(obtainItem().also { it.kind = if (discardCurrent) K_RESTART else K_NEW_PART })

    /**
     * The video encoder failed and a new one with the same settings took over. If its stream headers
     * are identical (the usual case) the recording simply goes on in the same file; otherwise the
     * new encoder's first key frame opens a new part.
     */
    fun encoderReplaced() = put(obtainItem().also { it.kind = K_REPLACED })

    /** Audio failed before it produced anything: continue with video only. */
    fun dropAudio() = put(obtainItem().also { it.kind = K_NO_AUDIO })

    /** Flushes everything, closes the last part and waits until every part is finalized. */
    fun finish() {
        if (!finished) {
            finished = true
            put(obtainItem().also { it.kind = K_FINISH })
        }
        try { writer.join(120_000) } catch (_: InterruptedException) {}
    }

    /**
     * The process is about to die (uncaught exception): close the open parts within [timeoutMs] so
     * they are playable MP4s, from whichever thread is crashing.
     */
    fun emergencyFinish(timeoutMs: Long) {
        if (Thread.currentThread() === writer || !writer.isAlive) {
            finished = true
            try { finishInternal() } catch (_: Throwable) {}
            return
        }
        if (!finished) {
            finished = true
            try { queue.offer(obtainItem().also { it.kind = K_FINISH }, timeoutMs / 2, TimeUnit.MILLISECONDS) } catch (_: Throwable) {}
        }
        try { writer.join(timeoutMs) } catch (_: Throwable) {}
    }

    fun parts(): List<Part> = synchronized(parts) { parts.values.filter { it.ok }.toList() }

    /** True when every part that was opened has been closed (finalized or deleted). */
    val allClosed: Boolean get() = synchronized(parts) { parts.values.all { it.finished } }

    private fun submitSample(kind: Int, src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, flags: Int) {
        if (finished) return
        val t0 = System.nanoTime()
        val b = pool.acquire(size)
        val waited = System.nanoTime() - t0
        if (waited > 1_000_000) waitNs += waited
        val dup = src.duplicate()
        dup.limit(offset + size)
        dup.position(offset)
        b.clear()
        b.put(dup)
        b.flip()
        val it = obtainItem()
        it.kind = kind
        it.buf = b
        it.info.set(0, size, ptsUs, flags)
        put(it)
    }

    private fun submitFormat(kind: Int, f: MediaFormat) {
        if (finished) return
        val it = obtainItem()
        it.kind = kind
        it.format = f
        put(it)
    }

    private fun obtainItem(): Item = items.poll() ?: Item()

    private fun put(it: Item) {
        queue.put(it)
        val n = queue.size
        if (n > maxQueued) maxQueued = n
    }

    private fun recycle(it: Item) {
        it.buf?.let { b -> pool.release(b) }
        it.buf = null
        it.format = null
        items.offer(it)
    }

    // ------------------------------------------------------------ writer thread

    private fun writerLoop() {
        Process.setThreadPriority(Process.THREAD_PRIORITY_DISPLAY)
        while (true) {
            val it = try { queue.poll(100, TimeUnit.MILLISECONDS) } catch (_: InterruptedException) { null }
            try {
                checkAudioTimeout()
                checkTail()
            } catch (e: Throwable) {
                onWriteFailure(e)
            }
            if (it == null) continue
            // Control items are recycled first; a sample item is recycled where it is written, so
            // after a failure it is recycled here only if that did not happen yet (never twice).
            var recycled = false
            try {
                when (it.kind) {
                    K_VFMT -> { val f = it.format; recycle(it); recycled = true; onVideoFormat(f) }
                    K_NEW_PART, K_RESTART -> { val restart = it.kind == K_RESTART; recycle(it); recycled = true; onNewPart(restart) }
                    K_REPLACED -> { recycle(it); recycled = true; onEncoderReplaced() }
                    K_AFMT -> { aFmt = it.format; recycle(it); recycled = true; if (audioWanted) flushPending() }
                    K_NO_AUDIO -> { recycle(it); recycled = true; giveUpAudio(false) }
                    K_VIDEO -> onVideo(it)
                    K_AUDIO -> onAudio(it)
                    K_FINISH -> {
                        recycle(it)
                        try { finishInternal() } catch (_: Throwable) {}
                        return
                    }
                    else -> { recycle(it); recycled = true }
                }
            } catch (e: Throwable) {
                if (!recycled) recycle(it)
                onWriteFailure(e)
            }
        }
    }

    /**
     * A write (MediaMuxer or MediaStore) failed. The part so far is closed cleanly (it stays a
     * playable file) and the next key frame starts a new part. Repeated failures, or a failure with
     * no part to save, end the recording.
     */
    private fun onWriteFailure(e: Throwable) {
        val msg = e.message ?: e.javaClass.simpleName
        val s = seg
        val now = System.nanoTime()
        val again = lastWriteFailNs != 0L && now - lastWriteFailNs < WRITE_RETRY_WINDOW_NS
        if (s == null || again || writeRecoveries >= MAX_WRITE_RECOVERIES) {
            if (!fatalSent) { fatalSent = true; events.onWriteError(msg) }
            return
        }
        writeRecoveries++
        lastWriteFailNs = now
        seg = null
        closeTail()
        finalizeSeg(s)
        forceReason = -1
        openReason = REASON_RECOVER
        keyWanted.set(true)
        events.onWriteRecovered(msg)
    }

    private fun ready() = vFmt != null && (!audioWanted || aFmt != null)

    /**
     * The format of the current encoder. A size change alone never decides anything here (1.2.2
     * compared output-format sizes, which some encoders don't report, so new-size frames could land
     * in the old track): a new part is started only by an explicit [newPart] command, or after an
     * encoder replacement whose stream headers differ.
     */
    private fun onVideoFormat(f: MediaFormat?) {
        f ?: return
        if (checkNextFormat) {
            checkNextFormat = false
            val s = seg
            if (s != null && forceReason < 0 && !sameStream(s.vFormat, f)) {
                forceReason = REASON_RECOVER
                keyWanted.set(true)
            }
        }
        vFmt = f
        flushPending()
    }

    private fun onNewPart(discard: Boolean) {
        // Frames still waiting for the audio format came from the old encoder: never mix them in.
        dropPending()
        if (seg == null) {
            vFmt = null  // the next format (from the new encoder) is the one the first part uses
            return
        }
        forceReason = if (discard) REASON_RESTART else REASON_ROTATE
        keyWanted.set(true)
    }

    private fun onEncoderReplaced() {
        dropPending()
        if (seg == null) { vFmt = null; return }
        checkNextFormat = true
        awaitKey = true
        keyWanted.set(true)
    }

    private fun dropPending() {
        for (p in pending) recycle(p)
        pending.clear()
        pendingSinceNs = 0L
    }

    private fun onVideo(it: Item) {
        if (!ready()) {
            val key = it.info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
            if (pending.isEmpty() && !key) { recycle(it); keyWanted.set(true); return }
            if (pending.isEmpty()) pendingSinceNs = System.nanoTime()
            pending += it
            return
        }
        flushPending()
        writeVideo(it)
    }

    private fun flushPending() {
        if (!ready() || pending.isEmpty()) return
        val list = ArrayList(pending)
        pending.clear()
        pendingSinceNs = 0L
        var i = 0
        try {
            while (i < list.size) { writeVideo(list[i]); i++ }
        } catch (e: Throwable) {
            for (j in i until list.size) recycle(list[j])   // the failed one and the rest
            throw e
        }
    }

    /** Waits at most about 2 s for the audio encoder; after that the video goes on without audio. */
    private fun checkAudioTimeout() {
        if (audioWanted && aFmt == null && pendingSinceNs != 0L && System.nanoTime() - pendingSinceNs > AUDIO_WAIT_NS) {
            giveUpAudio(true)
        }
    }

    private fun giveUpAudio(timeout: Boolean) {
        if (!audioWanted) return
        if (seg == null || timeout) {
            audioWanted = false
            events.onAudioGivenUp()
            flushPending()
        } else {
            // The current part already has an audio track; it simply ends. Later parts are video only.
            audioWanted = false
            events.onAudioGivenUp()
        }
    }

    private fun writeVideo(it: Item) {
        val info = it.info
        val key = info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0
        var s = seg
        if (s == null) {
            if (!key) { recycle(it); keyWanted.set(true); return }
            s = open(info.presentationTimeUs, openReason)
            openReason = REASON_START
            awaitKey = false
        } else if (forceReason >= 0 && !key) {
            keyWanted.set(true)
            // A size split waits for the key frame while the current part keeps every frame (1.4
            // dropped them, so each 3.5 GB split lost up to the key-frame interval of video). After
            // a rotation or an encoder change the new encoder's frames can't go into the old track.
            if (forceReason != REASON_SIZE) { recycle(it); return }
        } else if (forceReason >= 0) {
            val old: Seg = s
            seg = null
            if (forceReason == REASON_RESTART) {
                // Delete the first seconds now (frees the file name), then start over as part 1.
                closeTail()
                finalizeSeg(old, keep = false)
                segIndex = 0
                s = open(info.presentationTimeUs, REASON_RESTART)
            } else {
                keepAsTail(old)
                s = open(info.presentationTimeUs, forceReason)
            }
            forceReason = -1
            awaitKey = false
        } else if (awaitKey) {
            if (!key) { recycle(it); keyWanted.set(true); return }
            awaitKey = false
        }
        // No "pts must increase" filter here: dropping out-of-order frames (B-frames) corrupts the
        // picture until the next key frame. MediaMuxer orders them itself.
        if (info.presentationTimeUs < s.base) { recycle(it); return }
        write(s, s.vTrack, it)
        videoBytes += info.size
        if (forceReason < 0 && s.bytes >= minOf(segLimit, s.file.maxBytes)) {
            forceReason = REASON_SIZE
            keyWanted.set(true)
        }
        recycle(it)
    }

    private fun onAudio(it: Item) {
        val s = seg
        val pts = it.info.presentationTimeUs
        val t = tail
        if (t != null) {
            if (s == null || pts < s.base) {
                // Sound from just before the switch belongs at the end of the previous part.
                if (t.aTrack >= 0 && pts >= t.base && pts > t.lastA) {
                    t.lastA = pts
                    write(t, t.aTrack, it)
                    audioBytes += it.info.size
                }
                recycle(it)
                return
            }
            closeTail()   // the audio has reached the new part
        }
        if (s == null || s.aTrack < 0 || pts < s.base || pts <= s.lastA) { recycle(it); return }
        s.lastA = pts
        write(s, s.aTrack, it)
        audioBytes += it.info.size
        recycle(it)
    }

    private fun write(s: Seg, track: Int, it: Item) {
        val b = it.buf ?: return
        outInfo.set(0, it.info.size, it.info.presentationTimeUs - s.base, it.info.flags)
        s.file.write(track, b, outInfo)
        s.bytes += it.info.size
        totalBytes += it.info.size
        s.wrote = true
    }

    private fun open(base: Long, reason: Int): Seg {
        segIndex++
        val name = if (segIndex == 1) "$baseName.mp4" else "$baseName (${String.format(java.util.Locale.getDefault(), "%d", segIndex)}).mp4"
        val vf = vFmt ?: throw IllegalStateException("no video format")
        val file = sink.create(name)
        val part = Part(segIndex, file.uri, name, reason)
        synchronized(parts) { parts[segIndex] = part }
        try { events.onPartCreated(part) } catch (_: Throwable) {}
        val v: Int
        val a: Int
        try {
            v = file.addTrack(vf)
            val af = aFmt
            a = if (audioWanted && af != null) file.addTrack(af) else -1
            file.start()
        } catch (e: Exception) {
            // Never leave an empty pending entry behind.
            try { file.close(false) } catch (_: Throwable) {}
            synchronized(parts) { parts.remove(segIndex) }
            part.finished = true
            try { events.onPartFinished(part) } catch (_: Throwable) {}
            throw e
        }
        if (reason != REASON_START) events.onPartOpened(segIndex, reason)
        return Seg(part, file, v, a, base, vf).also { seg = it }
    }

    /** After a split the previous part stays open for up to 1.5 s for the late audio, then is closed. */
    private fun keepAsTail(old: Seg) {
        closeTail()
        if (old.aTrack >= 0 && audioWanted) {
            tail = old
            tailUntilNs = System.nanoTime() + TAIL_NS
        } else closeAsync(old)
    }

    private fun checkTail() {
        if (tail != null && System.nanoTime() > tailUntilNs) closeTail()
    }

    private fun closeTail() {
        val t = tail ?: return
        tail = null
        closeAsync(t)
    }

    /** Finalizing a big part takes a moment: done beside the writer so the new part keeps up. */
    private fun closeAsync(s: Seg) {
        closers += Thread({ finalizeSeg(s) }, "rawrec-close").also { t -> t.start() }
    }

    private fun finalizeSeg(s: Seg, keep: Boolean = true) {
        if (!s.closed.compareAndSet(false, true)) return
        val kept = keep && s.wrote
        val size = try { s.file.close(kept) } catch (_: Throwable) { -1L }
        if (kept) {
            s.part.bytes = if (size > 0) size else s.bytes
            s.part.ok = true
        } else {
            synchronized(parts) { parts.remove(s.part.index) }
        }
        s.part.finished = true
        try { events.onPartFinished(s.part) } catch (_: Throwable) {}
    }

    private fun finishInternal() {
        dropPending()
        // Drain anything still queued after FINISH was requested.
        while (true) { val it = queue.poll() ?: break; recycle(it) }
        closeTail()
        seg?.let { finalizeSeg(it) }
        seg = null
        for (t in closers.toList()) try { t.join(60_000) } catch (_: InterruptedException) {}
    }

    /** Same codec, size and stream headers (csd): frames of both encoders can share one MP4 track. */
    private fun sameStream(a: MediaFormat, b: MediaFormat): Boolean {
        fun int(f: MediaFormat, k: String) = if (f.containsKey(k)) f.getInteger(k) else -1
        if (a.getString(MediaFormat.KEY_MIME) != b.getString(MediaFormat.KEY_MIME)) return false
        if (int(a, MediaFormat.KEY_WIDTH) != int(b, MediaFormat.KEY_WIDTH) || int(a, MediaFormat.KEY_HEIGHT) != int(b, MediaFormat.KEY_HEIGHT)) return false
        for (k in arrayOf("csd-0", "csd-1", "csd-2")) {
            val x = if (a.containsKey(k)) a.getByteBuffer(k) else null
            val y = if (b.containsKey(k)) b.getByteBuffer(k) else null
            if ((x == null) != (y == null)) return false
            if (x != null && y != null) {
                val dx = x.duplicate(); dx.rewind()
                val dy = y.duplicate(); dy.rewind()
                if (dx != dy) return false
            }
        }
        return true
    }
}

/**
 * Recycled direct buffers in power-of-two size classes. After the first seconds no new buffers are
 * allocated, so recording does not create garbage per frame. When the budget is used up the
 * producer waits (back-pressure) instead of dropping frames, which would corrupt the stream.
 */
class BufferPool(private val budget: Long) {
    private val free = HashMap<Int, ArrayDeque<ByteBuffer>>()
    private var allocated = 0L
    private val lock = Object()

    private fun classOf(size: Int): Int {
        var c = 64 * 1024
        while (c < size) c = c shl 1
        return c
    }

    fun acquire(size: Int): ByteBuffer {
        val c = classOf(size)
        synchronized(lock) {
            while (true) {
                val q = free[c]
                if (q != null && q.isNotEmpty()) return q.removeFirst()
                if (allocated + c <= budget || allocated == 0L) {
                    allocated += c
                    return ByteBuffer.allocateDirect(c)
                }
                // Over budget: drop idle buffers of other sizes, else wait until the writer frees one.
                var freed = 0L
                for ((k, other) in free) {
                    if (k != c && other.isNotEmpty()) { freed += k.toLong() * other.size; other.clear() }
                }
                if (freed > 0) { allocated -= freed; continue }
                lock.wait(50)
            }
        }
    }

    fun release(b: ByteBuffer) {
        synchronized(lock) {
            free.getOrPut(b.capacity()) { ArrayDeque() }.addLast(b)
            lock.notifyAll()
        }
    }
}

/** Where the parts go. The app uses [MediaStoreSink]; tests use a fake to check part/track sizes. */
interface PartSink {
    fun create(name: String): PartFile
}

interface PartFile {
    val uri: Uri
    /** Largest size this file can take (MediaMuxer: 4 GB, RawRec's own writer: no limit). */
    val maxBytes: Long get() = Long.MAX_VALUE
    fun addTrack(f: MediaFormat): Int
    fun start()
    fun write(track: Int, buf: ByteBuffer, info: MediaCodec.BufferInfo)
    /** Finishes the file: [keep] publishes it in the gallery, otherwise it is deleted. Returns its size. */
    fun close(keep: Boolean): Long
}

/**
 * Movies/RawRec through MediaStore (no storage permission needed on Android 10+).
 *
 * Since 2.0 written by [Mp4Writer] (HEVC/H.264 + AAC): no 4 GB limit, so an hour of game is one
 * file, and a journal lets an interrupted file be finished on the next start ([recover]). Any other
 * codec (AV1), or codec data the writer can't read, goes through MediaMuxer as before — parts of
 * at most 3.5 GB then.
 */
class MediaStoreSink(private val ctx: Context) : PartSink {
    companion object {
        /** MediaMuxer writes 32-bit offsets: a part must stay under 4 GB. */
        const val MEDIA_MUXER_LIMIT = 3_500_000_000L

        fun journalFor(ctx: Context, uri: Uri): java.io.File =
            java.io.File(ctx.filesDir, "rec-" + (uri.lastPathSegment ?: "x").filter { it.isLetterOrDigit() } + ".rrj")

        /**
         * A part left open by a recording that was cut off: finish it from its journal and show it
         * in the gallery. False when there is nothing to finish it from (the caller deletes it).
         */
        fun recover(ctx: Context, uri: Uri): Boolean {
            val j = journalFor(ctx, uri)
            if (!j.exists()) return false
            val ok = try {
                ctx.contentResolver.openFileDescriptor(uri, "rw")?.use { pfd ->
                    java.io.FileOutputStream(pfd.fileDescriptor).channel.use { Mp4Writer.repair(j, it) }
                } ?: false
            } catch (_: Throwable) { false }
            if (ok) try {
                ctx.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
            } catch (_: Throwable) {}
            try { j.delete() } catch (_: Throwable) {}
            return ok
        }

        /** The encoder's MediaFormat as [Mp4Writer] needs it; null when the writer can't take it. */
        fun trackOf(f: MediaFormat): Mp4Track? {
            val mime = f.getString(MediaFormat.KEY_MIME) ?: return null
            if (!Mp4Writer.supports(mime)) return null
            val csd = (0..2).mapNotNull { k ->
                val b = if (f.containsKey("csd-$k")) f.getByteBuffer("csd-$k") else null
                b?.duplicate()?.let { d -> d.rewind(); ByteArray(d.remaining()).also { a -> d.get(a) } }
            }
            if (csd.isEmpty()) return null
            fun int(k: String, d: Int) = try { if (f.containsKey(k)) f.getInteger(k) else d } catch (_: Exception) { d }
            val video = mime.startsWith("video/")
            var w = int(MediaFormat.KEY_WIDTH, 0)
            var h = int(MediaFormat.KEY_HEIGHT, 0)
            if (f.containsKey("crop-right") && f.containsKey("crop-left")) w = int("crop-right", 0) - int("crop-left", 0) + 1
            if (f.containsKey("crop-bottom") && f.containsKey("crop-top")) h = int("crop-bottom", 0) - int("crop-top", 0) + 1
            if (video && (w <= 0 || h <= 0)) return null
            val std = int(MediaFormat.KEY_COLOR_STANDARD, -1)
            val (pri, mtx) = when (std) {
                MediaFormat.COLOR_STANDARD_BT709 -> 1 to 1
                MediaFormat.COLOR_STANDARD_BT601_PAL -> 5 to 5
                MediaFormat.COLOR_STANDARD_BT601_NTSC -> 6 to 6
                MediaFormat.COLOR_STANDARD_BT2020 -> 9 to 9
                else -> -1 to -1
            }
            val trc = when (int(MediaFormat.KEY_COLOR_TRANSFER, -1)) {
                MediaFormat.COLOR_TRANSFER_SDR_VIDEO -> 1
                MediaFormat.COLOR_TRANSFER_LINEAR -> 8
                MediaFormat.COLOR_TRANSFER_ST2084 -> 16
                MediaFormat.COLOR_TRANSFER_HLG -> 18
                else -> -1
            }
            return Mp4Track(
                video = video, mime = mime, width = w, height = h,
                sampleRate = int(MediaFormat.KEY_SAMPLE_RATE, 0), channels = int(MediaFormat.KEY_CHANNEL_COUNT, 0),
                bitrate = int(MediaFormat.KEY_BIT_RATE, 0), csd = csd,
                primaries = pri, transfer = trc, matrix = mtx,
                fullRange = int(MediaFormat.KEY_COLOR_RANGE, -1) == MediaFormat.COLOR_RANGE_FULL,
            )
        }
    }

    override fun create(name: String): PartFile {
        val values = ContentValues().apply {
            put(MediaStore.Video.Media.DISPLAY_NAME, name)
            put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
            put(MediaStore.Video.Media.RELATIVE_PATH, Environment.DIRECTORY_MOVIES + "/RawRec")
            put(MediaStore.Video.Media.IS_PENDING, 1)
        }
        val collection = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        val uri = ctx.contentResolver.insert(collection, values) ?: throw IllegalStateException("cannot create file in Movies/RawRec")
        val fd: android.os.ParcelFileDescriptor = try {
            ctx.contentResolver.openFileDescriptor(uri, "rw") ?: throw IllegalStateException("cannot open output file")
        } catch (e: Exception) {
            // Don't leave an empty hidden (pending) entry behind.
            try { ctx.contentResolver.delete(uri, null, null) } catch (_: Exception) {}
            throw e
        }
        val journal = journalFor(ctx, uri)
        return object : PartFile {
            private val formats = ArrayList<MediaFormat>()
            private var mp4: Mp4Writer? = null
            private var channel: java.nio.channels.FileChannel? = null
            private var muxer: MediaMuxer? = null

            override val uri = uri
            override val maxBytes get() = if (mp4 != null) Long.MAX_VALUE else MEDIA_MUXER_LIMIT

            override fun addTrack(f: MediaFormat): Int { formats += f; return formats.size - 1 }

            override fun start() {
                // RawRec's writer when it can take every track; it fails before writing a byte
                // when it can't (then MediaMuxer, as before).
                val tracks = formats.map { trackOf(it) }
                if (tracks.all { it != null }) {
                    try {
                        val ch = java.io.FileOutputStream(fd.fileDescriptor).channel
                        val w = Mp4Writer(ch, journal)
                        for (t in tracks) w.addTrack(t!!)
                        w.start()
                        channel = ch; mp4 = w
                        return
                    } catch (_: Exception) {
                        mp4 = null; channel = null
                        try { journal.delete() } catch (_: Exception) {}
                        try { java.io.FileOutputStream(fd.fileDescriptor).channel.truncate(0) } catch (_: Exception) {}
                    }
                }
                val m = MediaMuxer(fd.fileDescriptor, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
                for (f in formats) m.addTrack(f)
                m.start()
                muxer = m
            }

            override fun write(track: Int, buf: ByteBuffer, info: MediaCodec.BufferInfo) {
                val w = mp4
                if (w != null) {
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) return
                    w.write(track, buf, info.offset, info.size, info.presentationTimeUs, info.flags and MediaCodec.BUFFER_FLAG_KEY_FRAME != 0)
                } else muxer?.writeSampleData(track, buf, info)
            }

            override fun close(keep: Boolean): Long {
                val w = mp4
                if (w != null) {
                    try { if (keep) w.finish() else w.abandon() } catch (_: Exception) {}
                    try { channel?.close() } catch (_: Exception) {}
                }
                // stop() writes the MP4 index. It throws when a track got no samples, but the index is
                // still written in that case, so the file is kept (and playable) anyway.
                muxer?.let { m ->
                    try { m.stop() } catch (_: Exception) {}
                    try { m.release() } catch (_: Exception) {}
                }
                val size = try { fd.statSize } catch (_: Exception) { -1L }
                try { fd.close() } catch (_: Exception) {}
                try {
                    if (keep) ctx.contentResolver.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
                    else ctx.contentResolver.delete(uri, null, null)
                } catch (_: Exception) {}
                return size
            }
        }
    }
}
