package com.vil3ntec.rawrec

import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.channels.FileChannel

/**
 * One track for [Mp4Writer], as the encoder describes it (built from its MediaFormat in the app).
 * [csd]: the codec-specific data as MediaCodec gives it (HEVC: VPS+SPS+PPS, AVC: SPS and PPS, both
 * with start codes; AAC: the AudioSpecificConfig). Colour: ISO/IEC 23091-2 codes, -1 = not signalled.
 */
class Mp4Track(
    val video: Boolean,
    val mime: String,
    val width: Int = 0,
    val height: Int = 0,
    val sampleRate: Int = 0,
    val channels: Int = 0,
    val bitrate: Int = 0,
    val csd: List<ByteArray> = emptyList(),
    val primaries: Int = -1,
    val transfer: Int = -1,
    val matrix: Int = -1,
    val fullRange: Boolean = false,
)

/**
 * ══ RawRec's own MP4 writer (2.0) ══
 *
 * Android's MediaMuxer writes 32-bit offsets, so an MP4 can't pass 4 GB: RawRec had to cut every
 * 3.5 GB, and an hour of game came out as six to ten files («each one the continuation of the
 * other» — the owner). This writer has no size limit: one `mdat` with a 64-bit size, `co64` chunk
 * offsets, and the index (`moov`) written at the end like MediaMuxer does.
 *
 * Nothing is lost when the recording is cut off (battery, the system killing the app): every sample
 * is listed in a small journal next to the app's data, and [repair] writes the index from it on the
 * next start — the file is kept up to its last second instead of being deleted.
 *
 * HEVC (hvc1 + hvcC), H.264 (avc1 + avcC) and AAC (mp4a + esds); B-frames with `ctts` and an edit
 * list, sync samples, colour (`colr` nclx). Plain JVM code: tested on the build machine with ffmpeg.
 * Single writer thread; [finish] after the last [write].
 */
class Mp4Writer(
    private val ch: FileChannel,
    private val journal: File?,
    /** Tests only: an empty (sparse) `free` box this big before the media, to put it past 4 GB. */
    private val testGap: Long = 0,
) {

    companion object {
        const val HEVC = "video/hevc"
        const val AVC = "video/avc"
        const val AAC = "audio/mp4a-latm"
        fun supports(mime: String?) = mime == HEVC || mime == AVC || mime == AAC

        private const val VIDEO_TS = 90_000
        private const val MOVIE_TS = 1000
        private const val MAGIC = 0x52524A31   // "RRJ1"
        private const val FLUSH_EVERY = 48
        private const val SYNC_NS = 5_000_000_000L

        /**
         * Finish a file whose recording was cut off, from its [journal]: the samples it lists (whole
         * ones only) get an index; anything written after the last listed sample is cut off.
         * Returns false when the journal is unusable (the caller then deletes the file).
         */
        fun repair(journal: File, ch: FileChannel): Boolean {
            var state: State? = null
            var mdatStart = 0L
            try {
                DataInputStream(BufferedInputStream(FileInputStream(journal), 1 shl 16)).use { inp ->
                    if (inp.readInt() != MAGIC) return false
                    mdatStart = inp.readLong()
                    val n = inp.readInt()
                    if (n !in 1..8) return false
                    val tracks = ArrayList<Mp4Track>()
                    repeat(n) {
                        val video = inp.readBoolean()
                        val mime = inp.readUTF()
                        val w = inp.readInt(); val h = inp.readInt()
                        val sr = inp.readInt(); val chs = inp.readInt(); val br = inp.readInt()
                        val pr = inp.readInt(); val tr = inp.readInt(); val mx = inp.readInt(); val full = inp.readBoolean()
                        val cn = inp.readInt()
                        val csd = ArrayList<ByteArray>()
                        repeat(cn) { val b = ByteArray(inp.readInt()); inp.readFully(b); csd += b }
                        tracks += Mp4Track(video, mime, w, h, sr, chs, br, csd, pr, tr, mx, full)
                    }
                    val st = State(tracks.map { TrackState(it, entryFor(it)) })
                    state = st
                    val size = ch.size()
                    try {
                        while (true) {
                            val t = inp.readByte().toInt()
                            val off = inp.readLong()
                            val len = inp.readInt()
                            val pts = inp.readLong()
                            val key = inp.readByte().toInt() != 0
                            if (t !in st.tracks.indices || len <= 0 || off < mdatStart + 16 || off + len > size) break
                            st.tracks[t].add(off, len, pts, key)
                        }
                    } catch (_: EOFException) {}
                }
            } catch (_: Exception) {
                return false
            }
            val st = state ?: return false
            if (st.tracks.none { it.spec.video && it.n > 0 }) return false
            val end = st.tracks.maxOf { if (it.n > 0) it.off[it.n - 1] + it.size[it.n - 1] else 0L }
            ch.truncate(end)
            writeIndex(ch, st, mdatStart, end)
            return true
        }

        // ------------------------------------------------------------ index (moov)

        private fun writeIndex(ch: FileChannel, st: State, mdatStart: Long, end: Long) {
            val moov = st.moov()
            var p = end
            val b = ByteBuffer.wrap(moov)
            while (b.hasRemaining()) p += ch.write(b, p)
            // mdat: size 1 = «the 64-bit size follows»
            val hdr = ByteBuffer.allocate(8).putLong(end - mdatStart)
            hdr.flip()
            var q = mdatStart + 8
            while (hdr.hasRemaining()) q += ch.write(hdr, q)
            ch.force(true)
        }

        // ------------------------------------------------------------ sample entries

        /** The `stsd` entry for a track; throws when its codec data can't be read (the caller falls back). */
        internal fun entryFor(t: Mp4Track): ByteArray = when (t.mime) {
            HEVC -> visualEntry("hvc1", t, hvcC(t.csd))
            AVC -> visualEntry("avc1", t, avcC(t.csd))
            AAC -> audioEntry(t)
            else -> throw IllegalArgumentException("unsupported ${t.mime}")
        }

        private fun visualEntry(type: String, t: Mp4Track, config: ByteArray): ByteArray = Box.make(type) {
            zeros(6); u16(1)                       // reserved, data_reference_index
            u16(0); u16(0); zeros(12)              // pre_defined, reserved, pre_defined
            u16(t.width); u16(t.height)
            u32(0x00480000); u32(0x00480000)       // 72 dpi
            u32(0); u16(1)                         // reserved, frame_count
            zeros(32)                              // compressorname
            u16(0x0018); u16(0xFFFF)               // depth, pre_defined = -1
            bytes(config)
            if (t.primaries > 0 && t.transfer > 0 && t.matrix >= 0) box("colr") {
                fourcc("nclx"); u16(t.primaries); u16(t.transfer); u16(t.matrix); u8(if (t.fullRange) 0x80 else 0)
            }
            box("pasp") { u32(1); u32(1) }
        }

        private fun audioEntry(t: Mp4Track): ByteArray {
            val asc = t.csd.firstOrNull() ?: throw IllegalArgumentException("AAC without csd-0")
            return Box.make("mp4a") {
                zeros(6); u16(1)
                u32(0); u32(0)
                u16(t.channels.coerceIn(1, 8)); u16(16); u16(0); u16(0)
                u32((t.sampleRate.coerceIn(1, 65535)) shl 16)
                full("esds", 0, 0) {
                    val dsi = desc(0x05, asc)
                    val dcd = desc(0x04, Box.raw {
                        u8(0x40); u8(0x15); u24(0)
                        u32(t.bitrate.coerceAtLeast(0)); u32(t.bitrate.coerceAtLeast(0))
                        bytes(dsi)
                    })
                    val sl = desc(0x06, byteArrayOf(0x02))
                    bytes(desc(0x03, Box.raw { u16(0); u8(0); bytes(dcd); bytes(sl) }))
                }
            }
        }

        private fun desc(tag: Int, body: ByteArray): ByteArray = Box.raw {
            u8(tag)
            val n = body.size
            u8(0x80 or ((n shr 21) and 0x7F)); u8(0x80 or ((n shr 14) and 0x7F)); u8(0x80 or ((n shr 7) and 0x7F)); u8(n and 0x7F)
            bytes(body)
        }

        // ------------------------------------------------------------ HEVC / AVC configuration records

        /** NAL units (without start codes) of Annex-B data. */
        internal fun nals(data: ByteArray): List<ByteArray> {
            val out = ArrayList<ByteArray>()
            var i = 0
            var start = -1
            val n = data.size
            fun cut(s: Int, e0: Int) {
                var e = e0
                while (e > s && data[e - 1].toInt() == 0) e--
                if (e > s) out += data.copyOfRange(s, e)
            }
            while (i + 2 < n) {
                if (data[i].toInt() == 0 && data[i + 1].toInt() == 0 && data[i + 2].toInt() == 1) {
                    if (start >= 0) cut(start, i)
                    i += 3
                    start = i
                } else i++
            }
            if (start >= 0) cut(start, n)
            else if (n > 0) out += data   // no start codes: one NAL
            return out
        }

        private fun rbsp(nal: ByteArray, from: Int): ByteArray {
            val o = ByteArrayOutputStream(nal.size)
            var zeros = 0
            for (i in from until nal.size) {
                val b = nal[i].toInt() and 0xFF
                if (zeros >= 2 && b == 3) { zeros = 0; continue }
                zeros = if (b == 0) zeros + 1 else 0
                o.write(b)
            }
            return o.toByteArray()
        }

        internal fun hvcC(csd: List<ByteArray>): ByteArray {
            val all = csd.flatMap { nals(it) }
            fun type(n: ByteArray) = (n[0].toInt() shr 1) and 0x3F
            val vps = all.filter { it.size > 2 && type(it) == 32 }
            val sps = all.filter { it.size > 2 && type(it) == 33 }
            val pps = all.filter { it.size > 2 && type(it) == 34 }
            if (vps.isEmpty() || sps.isEmpty() || pps.isEmpty()) throw IllegalArgumentException("HEVC csd without VPS/SPS/PPS")
            val r = rbsp(sps[0], 2)
            val br = Bits(r)
            br.skip(4)                                  // sps_video_parameter_set_id
            val maxSubLayersMinus1 = br.u(3)
            val nested = br.u(1)
            val ptl = r.copyOfRange(1, 13)              // general profile_tier_level: 12 bytes
            br.skip(96)
            if (maxSubLayersMinus1 > 0) {
                val prof = BooleanArray(maxSubLayersMinus1)
                val lvl = BooleanArray(maxSubLayersMinus1)
                for (i in 0 until maxSubLayersMinus1) { prof[i] = br.u(1) == 1; lvl[i] = br.u(1) == 1 }
                for (i in maxSubLayersMinus1 until 8) br.skip(2)
                for (i in 0 until maxSubLayersMinus1) { if (prof[i]) br.skip(88); if (lvl[i]) br.skip(8) }
            }
            br.ue()                                     // sps_seq_parameter_set_id
            val chroma = br.ue()
            if (chroma == 3) br.skip(1)
            br.ue(); br.ue()                            // pic width, height
            if (br.u(1) == 1) { br.ue(); br.ue(); br.ue(); br.ue() }
            val depthL = br.ue()
            val depthC = br.ue()
            return Box.make("hvcC") {
                u8(1)
                bytes(ptl)                              // profile_space/tier/idc, compat flags, constraint flags, level
                u16(0xF000)                             // min_spatial_segmentation_idc = 0
                u8(0xFC)                                // parallelismType = 0
                u8(0xFC or (chroma and 3))
                u8(0xF8 or (depthL and 7))
                u8(0xF8 or (depthC and 7))
                u16(0)                                  // avgFrameRate
                u8(((maxSubLayersMinus1 + 1) shl 3) or (nested shl 2) or 3)   // lengthSizeMinusOne = 3
                u8(3)
                for ((t, list) in listOf(32 to vps, 33 to sps, 34 to pps)) {
                    u8(0x80 or t)                       // array_completeness = 1
                    u16(list.size)
                    for (n in list) { u16(n.size); bytes(n) }
                }
            }
        }

        internal fun avcC(csd: List<ByteArray>): ByteArray {
            val all = csd.flatMap { nals(it) }
            val sps = all.filter { it.size > 3 && (it[0].toInt() and 0x1F) == 7 }
            val pps = all.filter { it.isNotEmpty() && (it[0].toInt() and 0x1F) == 8 }
            if (sps.isEmpty() || pps.isEmpty()) throw IllegalArgumentException("AVC csd without SPS/PPS")
            val s = sps[0]
            val profile = s[1].toInt() and 0xFF
            val high = profile in setOf(100, 110, 122, 144)
            var chroma = 1; var depthL = 0; var depthC = 0
            if (high) {
                val br = Bits(rbsp(s, 4))
                br.ue()                                 // seq_parameter_set_id
                chroma = br.ue()
                if (chroma == 3) br.skip(1)
                depthL = br.ue(); depthC = br.ue()
            }
            return Box.make("avcC") {
                u8(1); u8(profile); u8(s[2].toInt() and 0xFF); u8(s[3].toInt() and 0xFF)
                u8(0xFF)                                // lengthSizeMinusOne = 3
                u8(0xE0 or sps.size)
                for (n in sps) { u16(n.size); bytes(n) }
                u8(pps.size)
                for (n in pps) { u16(n.size); bytes(n) }
                if (high) { u8(0xFC or (chroma and 3)); u8(0xF8 or (depthL and 7)); u8(0xF8 or (depthC and 7)); u8(0) }
            }
        }
    }

    // ------------------------------------------------------------ writing

    private val trackList = ArrayList<TrackState>()
    private val st = State(trackList)
    private val specs = ArrayList<Mp4Track>()
    private var pos = 0L
    private var mdatStart = 0L
    private var started = false
    private var finished = false
    private var conv: ByteBuffer = ByteBuffer.allocate(1 shl 20)
    private var jOut: DataOutputStream? = null
    private var jFos: FileOutputStream? = null
    private var jPending = 0
    private var lastSyncNs = 0L

    fun addTrack(t: Mp4Track): Int {
        check(!started)
        // Build the sample entry now: a codec configuration that can't be read fails here, before
        // a single byte is written, so the caller can still use MediaMuxer for this file.
        trackList.add(TrackState(t, entryFor(t)))
        specs += t
        return specs.size - 1
    }

    fun start() {
        check(!started && specs.isNotEmpty())
        started = true
        val ftyp = Box.make("ftyp") { fourcc("isom"); u32(0x200); fourcc("isom"); fourcc("iso2"); fourcc("mp41"); fourcc("mp42") }
        val head = ByteBuffer.allocate(ftyp.size + 32)
        head.put(ftyp)
        if (testGap > 0) { head.putInt(1); head.put("free".toByteArray(Charsets.US_ASCII)); head.putLong(testGap) }
        mdatStart = head.position().toLong() + (if (testGap > 0) testGap - 16 else 0)
        head.flip()
        pos = 0
        while (head.hasRemaining()) pos += ch.write(head, pos)
        val mdat = ByteBuffer.allocate(16)
        mdat.putInt(1); mdat.put("mdat".toByteArray(Charsets.US_ASCII)); mdat.putLong(0)   // size filled in by finish()
        mdat.flip()
        pos = mdatStart
        while (mdat.hasRemaining()) pos += ch.write(mdat, pos)
        openJournal()
    }

    /** One encoded sample of [track], in decode order. Video may be Annex-B (start codes) or length-prefixed. */
    fun write(track: Int, src: ByteBuffer, offset: Int, size: Int, ptsUs: Long, key: Boolean) {
        check(started && !finished)
        if (size <= 0) return
        val t = st.tracks[track]
        val data = if (t.spec.video) lengthPrefixed(src, offset, size, t.spec.mime == HEVC)
        else src.duplicate().also { it.limit(offset + size); it.position(offset) }
        val n = data.remaining()
        if (n <= 0) return
        val at = pos
        while (data.hasRemaining()) pos += ch.write(data, pos)
        t.add(at, n, ptsUs, key)
        journalAdd(track, at, n, ptsUs, key)
    }

    /** Writes the index; the file is complete and playable afterwards. */
    fun finish() {
        if (!started || finished) return
        finished = true
        closeJournal()
        writeIndex(ch, st, mdatStart, pos)
        try { journal?.delete() } catch (_: Exception) {}
    }

    /** The recording is thrown away: no index, and no journal left to repair it from. */
    fun abandon() {
        finished = true
        closeJournal()
        try { journal?.delete() } catch (_: Exception) {}
    }

    val bytesWritten get() = pos

    /** Tests: what a killed process left behind (its journal up to the last flush). */
    internal fun flushJournalForTest() { try { jOut?.flush() } catch (_: Exception) {} }

    // ------------------------------------------------------------ Annex-B → 4-byte lengths

    private fun lengthPrefixed(src: ByteBuffer, off: Int, len: Int, hevc: Boolean): ByteBuffer {
        val end = off + len
        fun sc(i: Int): Int {
            if (i + 3 > end || src.get(i).toInt() != 0 || src.get(i + 1).toInt() != 0) return 0
            val b2 = src.get(i + 2).toInt()
            if (b2 == 1) return 3
            if (b2 == 0 && i + 4 <= end && src.get(i + 3).toInt() == 1) return 4
            return 0
        }
        if (sc(off) == 0) return src.duplicate().also { it.limit(end); it.position(off) }   // already length-prefixed
        val need = len + len / 3 + 64
        if (conv.capacity() < need) conv = ByteBuffer.allocate(need + (need shr 2))
        conv.clear()
        var start = -1
        var i = off
        fun emit(s: Int, e0: Int) {
            var e = e0
            while (e > s && src.get(e - 1).toInt() == 0) e--
            if (e <= s) return
            val h = src.get(s).toInt()
            // Parameter sets live in the sample entry (hvc1/avc1); access unit delimiters are noise.
            val skip = if (hevc) ((h shr 1) and 0x3F) in 32..35 else (h and 0x1F) in 7..9
            if (skip) return
            conv.putInt(e - s)
            val d = src.duplicate()
            d.limit(e); d.position(s)
            conv.put(d)
        }
        while (i + 2 < end) {
            val b2 = src.get(i + 2).toInt() and 0xFF
            if (b2 > 1) { i += 3; continue }
            if (b2 == 1 && src.get(i + 1).toInt() == 0 && src.get(i).toInt() == 0) {
                if (start >= 0) emit(start, i)
                i += 3
                start = i
                continue
            }
            i++
        }
        if (start >= 0) emit(start, end)
        conv.flip()
        return conv
    }

    // ------------------------------------------------------------ journal

    private fun openJournal() {
        val f = journal ?: return
        try {
            val fos = FileOutputStream(f)
            val out = DataOutputStream(BufferedOutputStream(fos, 1 shl 15))
            out.writeInt(MAGIC)
            out.writeLong(mdatStart)
            out.writeInt(specs.size)
            for (t in specs) {
                out.writeBoolean(t.video); out.writeUTF(t.mime)
                out.writeInt(t.width); out.writeInt(t.height)
                out.writeInt(t.sampleRate); out.writeInt(t.channels); out.writeInt(t.bitrate)
                out.writeInt(t.primaries); out.writeInt(t.transfer); out.writeInt(t.matrix); out.writeBoolean(t.fullRange)
                out.writeInt(t.csd.size)
                for (c in t.csd) { out.writeInt(c.size); out.write(c) }
            }
            out.flush()
            fos.fd.sync()
            jFos = fos; jOut = out
            lastSyncNs = System.nanoTime()
        } catch (_: Exception) {
            jOut = null; jFos = null
        }
    }

    private fun journalAdd(track: Int, off: Long, len: Int, pts: Long, key: Boolean) {
        val out = jOut ?: return
        try {
            out.writeByte(track); out.writeLong(off); out.writeInt(len); out.writeLong(pts); out.writeByte(if (key) 1 else 0)
            if (++jPending >= FLUSH_EVERY) {
                jPending = 0
                out.flush()
                val now = System.nanoTime()
                if (now - lastSyncNs > SYNC_NS) { lastSyncNs = now; jFos?.fd?.sync() }
            }
        } catch (_: Exception) {
            jOut = null
        }
    }

    private fun closeJournal() {
        try { jOut?.close() } catch (_: Exception) {}
        jOut = null; jFos = null
    }
}

// ------------------------------------------------------------------ samples and the index

private class TrackState(val spec: Mp4Track, val entry: ByteArray) {
    var n = 0
    var off = LongArray(1024)
    var size = IntArray(1024)
    var pts = LongArray(1024)
    var key = BooleanArray(1024)

    fun add(o: Long, s: Int, p: Long, k: Boolean) {
        if (n == off.size) {
            val c = n * 2
            off = off.copyOf(c); size = size.copyOf(c); pts = pts.copyOf(c); key = key.copyOf(c)
        }
        off[n] = o; size[n] = s; pts[n] = p; key[n] = k
        n++
    }
}

private class State(val tracks: List<TrackState>) {

    /** Per track: decode times, composition offsets, durations — all in the track's timescale. */
    private class Timing(val ts: Int, val dur: LongArray, val ctts: LongArray?, val shift: Long, val firstUs: Long, val mediaDur: Long)

    private fun timing(t: TrackState): Timing {
        val ts = if (t.spec.video) 90_000 else t.spec.sampleRate.coerceAtLeast(1)
        val n = t.n
        var firstUs = Long.MAX_VALUE
        for (i in 0 until n) if (t.pts[i] < firstUs) firstUs = t.pts[i]
        val p = LongArray(n) { Math.round((t.pts[it] - firstUs) * ts / 1_000_000.0) }
        // Decode times: the presentation times in order (frames come out of the encoder in decode
        // order; with B-frames a later-shown frame comes first), strictly increasing.
        val s = p.copyOf()
        s.sort()
        for (i in 1 until n) if (s[i] <= s[i - 1]) s[i] = s[i - 1] + 1
        var shift = 0L
        for (i in 0 until n) if (s[i] - p[i] > shift) shift = s[i] - p[i]
        val dur = LongArray(n)
        for (i in 0 until n - 1) dur[i] = s[i + 1] - s[i]
        dur[n - 1] = when {
            n >= 2 -> dur[n - 2]
            t.spec.video -> (ts / 30).toLong()
            else -> 1024L
        }
        var reordered = false
        val c = LongArray(n) { val v = p[it] - s[it] + shift; if (v != 0L) reordered = true; v }
        return Timing(ts, dur, if (reordered) c else null, shift, firstUs, s[n - 1] - s[0] + dur[n - 1])
    }

    fun moov(): ByteArray {
        val live = tracks.filter { it.n > 0 }
        val times = live.map { timing(it) }
        val origin = times.minOfOrNull { it.firstUs } ?: 0L
        val movieDurs = times.map { tm -> (tm.firstUs - origin) / 1000 + tm.mediaDur * 1000 / tm.ts }
        val movieDur = movieDurs.maxOrNull() ?: 0L
        val now = System.currentTimeMillis() / 1000 + 2_082_844_800L
        return Box.make("moov") {
            full("mvhd", 0, 0) {
                u32(now); u32(now); u32(1000); u32(movieDur)
                u32(0x00010000); u16(0x0100); u16(0); u32(0); u32(0)
                matrix()
                zeros(24)
                u32(live.size + 1L)
            }
            for ((k, t) in live.withIndex()) trak(this, k + 1, t, times[k], (times[k].firstUs - origin) / 1000, movieDurs[k], now)
        }
    }

    private fun trak(m: Box, id: Int, t: TrackState, tm: Timing, delayMs: Long, movieDur: Long, now: Long) = m.box("trak") {
        val v = t.spec.video
        full("tkhd", 0, 3) {
            u32(now); u32(now); u32(id.toLong()); u32(0); u32(movieDur)
            u32(0); u32(0); u16(0); u16(0); u16(if (v) 0 else 0x0100); u16(0)
            matrix()
            u32(if (v) t.spec.width.toLong() shl 16 else 0); u32(if (v) t.spec.height.toLong() shl 16 else 0)
        }
        box("edts") {
            val empty = delayMs > 0
            full("elst", 0, 0) {
                u32(if (empty) 2 else 1)
                if (empty) { u32(delayMs); u32(0xFFFFFFFFL); u16(1); u16(0) }
                u32(tm.mediaDur * 1000 / tm.ts); u32(tm.shift); u16(1); u16(0)
            }
        }
        box("mdia") {
            if (tm.mediaDur > 0xFFFFFFFFL) full("mdhd", 1, 0) { u64(now); u64(now); u32(tm.ts.toLong()); u64(tm.mediaDur); u16(0x55C4); u16(0) }
            else full("mdhd", 0, 0) { u32(now); u32(now); u32(tm.ts.toLong()); u32(tm.mediaDur); u16(0x55C4); u16(0) }
            full("hdlr", 0, 0) {
                u32(0); fourcc(if (v) "vide" else "soun"); u32(0); u32(0); u32(0)
                bytes((if (v) "RawRec Video" else "RawRec Audio").toByteArray(Charsets.US_ASCII)); u8(0)
            }
            box("minf") {
                if (v) full("vmhd", 0, 1) { u16(0); u16(0); u16(0); u16(0) }
                else full("smhd", 0, 0) { u16(0); u16(0) }
                box("dinf") { full("dref", 0, 0) { u32(1); full("url ", 0, 1) {} } }
                box("stbl") {
                    full("stsd", 0, 0) { u32(1); bytes(t.entry) }
                    full("stts", 0, 0) { runs(tm.dur, t.n) }
                    tm.ctts?.let { c -> full("ctts", 0, 0) { runs(c, t.n) } }
                    if (v) {
                        var keys = 0
                        for (i in 0 until t.n) if (t.key[i]) keys++
                        if (keys < t.n) full("stss", 0, 0) {
                            u32(keys.toLong())
                            for (i in 0 until t.n) if (t.key[i]) u32(i + 1L)
                        }
                    }
                    // Chunks: runs of samples of this track written one right after the other.
                    val chunkOff = ArrayList<Long>()
                    val chunkLen = ArrayList<Int>()
                    for (i in 0 until t.n) {
                        if (i == 0 || t.off[i] != t.off[i - 1] + t.size[i - 1]) { chunkOff += t.off[i]; chunkLen += 1 }
                        else chunkLen[chunkLen.size - 1] = chunkLen[chunkLen.size - 1] + 1
                    }
                    full("stsc", 0, 0) {
                        val first = ArrayList<Int>()
                        for (c in chunkLen.indices) if (c == 0 || chunkLen[c] != chunkLen[c - 1]) first += c
                        u32(first.size.toLong())
                        for (c in first) { u32(c + 1L); u32(chunkLen[c].toLong()); u32(1) }
                    }
                    full("stsz", 0, 0) {
                        u32(0); u32(t.n.toLong())
                        for (i in 0 until t.n) u32(t.size[i].toLong())
                    }
                    full("co64", 0, 0) {
                        u32(chunkOff.size.toLong())
                        for (o in chunkOff) u64(o)
                    }
                }
            }
        }
    }

    private fun Box.runs(vals: LongArray, n: Int) {
        var count = 0
        val body = Box()
        var i = 0
        while (i < n) {
            var j = i
            while (j + 1 < n && vals[j + 1] == vals[i]) j++
            body.u32(j - i + 1L); body.u32(vals[i])
            count++
            i = j + 1
        }
        u32(count.toLong())
        bytes(body.toByteArray())
    }
}

// ------------------------------------------------------------------ bytes

private class Box {
    private val o = ByteArrayOutputStream()

    fun u8(v: Int) = o.write(v and 0xFF)
    fun u16(v: Int) { u8(v shr 8); u8(v) }
    fun u24(v: Int) { u8(v shr 16); u8(v shr 8); u8(v) }
    fun u32(v: Long) { u8((v shr 24).toInt()); u8((v shr 16).toInt()); u8((v shr 8).toInt()); u8(v.toInt()) }
    fun u32(v: Int) = u32(v.toLong())
    fun u64(v: Long) { u32(v ushr 32); u32(v and 0xFFFFFFFFL) }
    fun zeros(n: Int) { repeat(n) { o.write(0) } }
    fun bytes(b: ByteArray) = o.write(b, 0, b.size)
    fun fourcc(s: String) = bytes(s.toByteArray(Charsets.US_ASCII))
    fun matrix() { u32(0x00010000); u32(0); u32(0); u32(0); u32(0x00010000); u32(0); u32(0); u32(0); u32(0x40000000) }
    fun toByteArray(): ByteArray = o.toByteArray()

    fun box(type: String, body: Box.() -> Unit) = bytes(make(type, body))
    fun full(type: String, version: Int, flags: Int, body: Box.() -> Unit) = bytes(make(type) { u8(version); u24(flags); body() })

    companion object {
        fun make(type: String, body: Box.() -> Unit): ByteArray {
            val inner = Box().apply(body).toByteArray()
            val b = Box()
            b.u32(8L + inner.size); b.fourcc(type); b.bytes(inner)
            return b.toByteArray()
        }
        fun raw(body: Box.() -> Unit): ByteArray = Box().apply(body).toByteArray()
    }
}

/** Bit reader for parameter-set RBSP (exp-Golomb). */
private class Bits(private val b: ByteArray) {
    private var p = 0
    fun u(n: Int): Int {
        var v = 0
        repeat(n) {
            val byte = if (p shr 3 < b.size) b[p shr 3].toInt() else 0
            v = (v shl 1) or ((byte shr (7 - (p and 7))) and 1)
            p++
        }
        return v
    }
    fun skip(n: Int) { p += n }
    fun ue(): Int {
        var zeros = 0
        while (u(1) == 0 && zeros < 31) zeros++
        return if (zeros == 0) 0 else ((1 shl zeros) - 1 + u(zeros))
    }
}
