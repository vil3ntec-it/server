package com.vil3ntec.rawrec

import android.media.MediaCodec
import android.media.MediaCodecInfo.CodecProfileLevel
import android.media.MediaFormat
import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.nio.ByteBuffer
import kotlin.math.PI
import kotlin.math.sin

/** Rotation and shake decisions, levels and bit rates, and the muxer's part/track bookkeeping, without a real encoder. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class RecordingLogicTest {

    @Test fun oneRotationIsOneSwitch() {
        val p = RotationPolicy(auto = true, smartStart = true)
        p.start(landscapeNow = false)
        assertEquals(RotationPolicy.Action.RESTART, p.onDisplay(true, 3_000))      // within 10 s: restart, one file
        assertEquals(RotationPolicy.Action.NONE, p.onDisplay(true, 3_400))         // duplicate event: nothing
        assertEquals(RotationPolicy.Action.NONE, p.onDisplay(true, 3_900))
        assertEquals(RotationPolicy.Action.NEW_PART, p.onDisplay(false, 30_000))  // later: a new part
        assertEquals(RotationPolicy.Action.NONE, p.onDisplay(false, 30_500))
    }

    @Test fun lockedOrientationNeverSwitches() {
        val p = RotationPolicy(auto = false, smartStart = true)
        p.start(true)
        assertEquals(RotationPolicy.Action.NONE, p.onDisplay(false, 1_000))
        assertEquals(RotationPolicy.Action.NONE, p.onDisplay(true, 20_000))
    }

    @Test fun smartStartOffMakesAPartEvenEarly() {
        val p = RotationPolicy(auto = true, smartStart = false)
        p.start(false)
        assertEquals(RotationPolicy.Action.NEW_PART, p.onDisplay(true, 2_000))
    }

    @Test fun aNewScreenSizeGetsANewCanvasInAnyOrientationMode() {
        val locked = RotationPolicy(auto = false, smartStart = true)
        locked.start(true)
        assertEquals(RotationPolicy.Action.NEW_PART, locked.onDisplay(true, 60_000, resized = true))   // foldable opened
        val auto = RotationPolicy(auto = true, smartStart = true)
        auto.start(false)
        assertEquals(RotationPolicy.Action.NONE, auto.onDisplay(false, 60_000, resized = false))
        assertEquals(RotationPolicy.Action.NEW_PART, auto.onDisplay(false, 60_000, resized = true))
    }

    // ---- shake to stop: only a deliberate back-and-forth shake

    private fun feed(s: ShakeGesture, samples: List<Triple<Float, Float, Float>>, t0: Long = 10_000): Boolean {
        var fired = false
        for ((i, v) in samples.withIndex()) if (s.onSample(v.first, v.second, v.third, t0 + i * 20L)) fired = true
        return fired
    }

    @Test fun aRealShakeStops() {
        // 5 swings per second, about 3 g, along the phone's x axis, gravity on z.
        val shake = (0 until 60).map { i -> Triple((30 * sin(2 * PI * 5 * i * 0.02)).toFloat(), 0f, 9.81f) }
        assertTrue(feed(ShakeGesture(), listOf(Triple(0f, 0f, 9.81f)) + shake))
    }

    @Test fun runningBumpsAndTapsNeverStop() {
        // Footsteps / bumps: hard one-way jolts every 300 ms (up to 3.5 g), for 10 s.
        val steps = (0 until 500).map { i -> Triple(0f, 1f, if (i % 15 < 2) 9.81f + 34f else 9.81f - 4f) }
        assertFalse(feed(ShakeGesture(), listOf(Triple(0f, 1f, 9.81f)) + steps))
        // A shake in the first seconds after start (still being set up) does not count either.
        val g = ShakeGesture().also { it.armedAtMs = 20_000 }
        val shake = (0 until 60).map { i -> Triple((30 * sin(2 * PI * 5 * i * 0.02)).toFloat(), 0f, 9.81f) }
        assertFalse(feed(g, listOf(Triple(0f, 0f, 9.81f)) + shake))
    }

    // ---- bit rates and codec levels

    @Test fun bitrateIsFidelityFirstButLightStaysSmall() {
        val tablet = Planner.autoBitrate(1504, 2400, 120, Encoders.HEVC, RecordConfig.BR_AUTO_HIGH)
        assertTrue("50–62 Mbps, was ${tablet / 1_000_000}", tablet in 50_000_000..62_000_000)
        val ref = Planner.referenceRange(1504, 2400, 120, Encoders.HEVC)
        assertTrue(tablet / 1_000_000 in ref.first..ref.second)
        val fhd = Planner.autoBitrate(1920, 1080, 60, Encoders.HEVC, RecordConfig.BR_AUTO_HIGH)
        assertTrue("1080p60 HEVC ≥ 18 Mbps, was ${fhd / 1_000_000}", fhd >= 18_000_000)
        val light = Planner.autoBitrate(1080, 2400, 30, Encoders.HEVC, RecordConfig.BR_AUTO_BALANCED)
        assertTrue("light ≤ 6 Mbps, was ${light / 1_000_000}", light <= 6_000_000)
        assertTrue(Planner.qpCeiling(RecordConfig.BR_AUTO_HIGH) <= 21)
        assertTrue(Planner.qpCeiling(RecordConfig.BR_MAX) < Planner.qpCeiling(RecordConfig.BR_AUTO_HIGH))
    }

    @Test fun levelIsTheLowestThatFitsNotTheEncodersHighest() {
        val main62 = CodecProfileLevel.HEVCMainTierLevel62
        // 1080p60 with a 28 Mbps peak: Main tier 5.1 (4.1 and 5 allow only 20 / 25 Mbps).
        assertEquals(CodecProfileLevel.HEVCMainTierLevel51, Encoders.minLevel(Encoders.HEVC, 1920, 1080, 60, 28_000_000, main62, false)?.first)
        // With high tier available 4.1 High (50 Mbps) is enough.
        assertEquals(CodecProfileLevel.HEVCHighTierLevel41, Encoders.minLevel(Encoders.HEVC, 1920, 1080, 60, 28_000_000, CodecProfileLevel.HEVCHighTierLevel62, true)?.first)
        // The owner's tablet at 120 fps with a 72 Mbps peak: 6.1 Main.
        assertEquals(CodecProfileLevel.HEVCMainTierLevel61, Encoders.minLevel(Encoders.HEVC, 1504, 2400, 120, 72_000_000, main62, false)?.first)
        // H.264 High 1080p60 at 42 Mbps: 4.2.
        assertEquals(CodecProfileLevel.AVCLevel42, Encoders.minLevel(Encoders.AVC, 1920, 1080, 60, 42_000_000, CodecProfileLevel.AVCLevel52, false)?.first)
        // AV1 1080p60 at 20 Mbps: 4.1.
        assertEquals(CodecProfileLevel.AV1Level41, Encoders.minLevel(Encoders.AV1, 1920, 1080, 60, 20_000_000, CodecProfileLevel.AV1Level63, false)?.first)
        // The encoder's own ceiling is never exceeded; its bit-rate limit then caps the plan.
        assertNull(Encoders.minLevel(Encoders.HEVC, 1920, 1080, 60, 28_000_000, CodecProfileLevel.HEVCMainTierLevel41, false))
        val capped = Encoders.levelFor(Encoders.HEVC, CodecProfileLevel.HEVCProfileMain, CodecProfileLevel.HEVCMainTierLevel41, 1920, 1080, 60, 28_000_000)
        assertEquals(CodecProfileLevel.HEVCMainTierLevel41 to 20_000_000L, capped)
    }

    // ---- muxer with a fake sink: each part must contain only frames of its own track size

    private data class Sample(val track: Int, val w: Int, val h: Int, val pts: Long)

    private class FakeFile(val name: String, val failAtWrite: Int) : PartFile {
        override val uri: Uri = Uri.parse("fake://$name")
        val trackSizes = ArrayList<Pair<Int, Int>>()
        val frames = ArrayList<Sample>()
        var kept: Boolean? = null
        override fun addTrack(f: MediaFormat): Int {
            trackSizes += if (f.containsKey(MediaFormat.KEY_WIDTH)) f.getInteger(MediaFormat.KEY_WIDTH) to f.getInteger(MediaFormat.KEY_HEIGHT) else (0 to 0)
            return trackSizes.size - 1
        }
        override fun start() {}
        override fun write(track: Int, buf: ByteBuffer, info: MediaCodec.BufferInfo) {
            if (frames.size == failAtWrite) throw IllegalStateException("writeSampleData returned an error")
            val d = buf.duplicate(); d.position(info.offset)
            frames += Sample(track, d.int, d.int, info.presentationTimeUs)
        }
        override fun close(keep: Boolean): Long { kept = keep; return frames.size * 100L }
        fun video() = frames.filter { it.track == 0 }
        fun audio() = frames.filter { it.track == 1 }
    }

    private class FakeSink(val failAtWrite: Int = -1) : PartSink {
        val files = ArrayList<FakeFile>()
        override fun create(name: String) = FakeFile(name, if (files.isEmpty()) failAtWrite else -1).also { synchronized(files) { files += it } }
    }

    private class Events : SegMuxer.Events {
        val opened = ArrayList<Pair<Int, Int>>()
        @Volatile var writeErrors = 0
        @Volatile var recovered = 0
        override fun onAudioGivenUp() {}
        override fun onPartOpened(index: Int, reason: Int) { synchronized(opened) { opened += index to reason } }
        override fun onWriteError(message: String) { writeErrors++ }
        override fun onWriteRecovered(message: String) { recovered++ }
    }

    private fun frame(m: SegMuxer, w: Int, h: Int, pts: Long, key: Boolean) {
        val b = ByteBuffer.allocateDirect(64); b.putInt(w); b.putInt(h); b.flip()
        m.submitVideo(b, 0, 8, pts, if (key) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
    }

    private fun audio(m: SegMuxer, pts: Long) {
        val b = ByteBuffer.allocateDirect(64); b.putInt(-1); b.putInt(-1); b.flip()
        m.submitAudio(b, 0, 8, pts, 0)
    }

    private fun fmt(w: Int, h: Int, csd: Byte = 1) = MediaFormat.createVideoFormat(MediaFormat.MIMETYPE_VIDEO_HEVC, w, h).apply {
        setByteBuffer("csd-0", ByteBuffer.wrap(byteArrayOf(0, 0, 0, 1, csd)))
    }

    private fun record(restart: Boolean): FakeSink {
        val sink = FakeSink()
        val m = SegMuxer(sink, false, Long.MAX_VALUE, "RawRec 2026-10-31 17-02", Events())
        m.videoFormat(fmt(1504, 2400))
        var pts = 0L
        frame(m, 1504, 2400, pts, true)
        repeat(30) { pts += 8_333; frame(m, 1504, 2400, pts, false) }
        // rotation: the old encoder's last frames, then the switch, then the new encoder
        repeat(3) { pts += 8_333; frame(m, 1504, 2400, pts, false) }
        m.newPart(discardCurrent = restart)
        m.videoFormat(fmt(2400, 1504))
        pts += 120_000
        frame(m, 2400, 1504, pts, true)
        repeat(60) { pts += 8_333; frame(m, 2400, 1504, pts, false) }
        m.finish()
        return sink
    }

    @Test fun rotationStartsANewPartWithTheRightTrackSize() {
        val sink = record(restart = false)
        assertEquals(2, sink.files.size)
        for (f in sink.files) {
            val track = f.trackSizes[0]
            assertTrue("${f.name}: every frame matches its track $track", f.frames.all { (it.w to it.h) == track })
            assertEquals(true, f.kept)
        }
        assertEquals(1504 to 2400, sink.files[0].trackSizes[0])
        assertEquals(34, sink.files[0].frames.size)                     // no frame of the old encoder lost
        assertEquals(2400 to 1504, sink.files[1].trackSizes[0])
        assertEquals("RawRec 2026-10-31 17-02.mp4", sink.files[0].name)
        assertTrue(sink.files[1].name.startsWith("RawRec 2026-10-31 17-02 ("))
    }

    @Test fun smartStartKeepsOneFileInTheNewOrientation() {
        val sink = record(restart = true)
        val kept = sink.files.filter { it.kept == true }
        assertEquals(1, kept.size)
        assertEquals(false, sink.files[0].kept)                       // the first seconds were deleted
        assertEquals(2400 to 1504, kept[0].trackSizes[0])
        assertTrue(kept[0].frames.all { (it.w to it.h) == (2400 to 1504) })
        assertEquals("RawRec 2026-10-31 17-02.mp4", kept[0].name)       // the single file keeps the plain name
    }

    @Test fun sizeSplitLosesNoFrameAndKeepsTheSoundTogether() {
        val sink = FakeSink()
        val ev = Events()
        // Split after 30 samples of 8 bytes (video + audio).
        val m = SegMuxer(sink, true, 8L * 30, "RawRec split", ev)
        m.audioFormat(MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, 48_000, 2))
        m.videoFormat(fmt(1080, 2400))
        for (i in 0 until 25) { frame(m, 1080, 2400, i * 10_000L, i == 0); audio(m, i * 10_000L + 5_000) }
        // The encoder answers the key-frame request a few frames late: every frame until then stays in part 1.
        frame(m, 1080, 2400, 250_000, true)
        audio(m, 247_000); audio(m, 249_000)                          // sound from just before the key frame
        audio(m, 255_000)
        for (i in 26 until 31) { frame(m, 1080, 2400, i * 10_000L, false); audio(m, i * 10_000L + 5_000) }
        m.finish()
        assertEquals(2, sink.files.size)
        val (a, b) = sink.files
        assertEquals(25, a.video().size)
        assertEquals(6, b.video().size)
        assertEquals(249_000L, a.audio().maxOf { it.pts })               // the late sound ended part 1
        assertEquals(5_000L, b.audio().minOf { it.pts })                 // part 2 starts at its key frame (pts 250 000)
        assertTrue(a.kept == true && b.kept == true)
        assertTrue(ev.opened.contains(2 to SegMuxer.REASON_SIZE))
    }

    @Test fun aWriteErrorClosesThePartCleanlyAndRecordingGoesOn() {
        val sink = FakeSink(failAtWrite = 10)
        val ev = Events()
        val m = SegMuxer(sink, false, Long.MAX_VALUE, "RawRec err", ev)
        m.videoFormat(fmt(1080, 2400))
        frame(m, 1080, 2400, 0, true)
        for (i in 1 until 20) frame(m, 1080, 2400, i * 10_000L, false)  // write #10 fails; the rest waits for a key frame
        frame(m, 1080, 2400, 200_000, true)
        for (i in 21 until 30) frame(m, 1080, 2400, i * 10_000L, false)
        m.finish()
        assertEquals(0, ev.writeErrors)
        assertEquals(1, ev.recovered)
        assertEquals(2, sink.files.size)
        assertEquals(10, sink.files[0].frames.size)                      // everything before the failure, finalized
        assertEquals(true, sink.files[0].kept)
        assertEquals(10, sink.files[1].frames.size)
        assertTrue(ev.opened.contains(2 to SegMuxer.REASON_RECOVER))
    }

    @Test fun aReplacedEncoderWithTheSameHeadersContinuesTheSameFile() {
        val sink = FakeSink()
        val m = SegMuxer(sink, false, Long.MAX_VALUE, "RawRec enc", Events())
        m.videoFormat(fmt(1080, 2400))
        frame(m, 1080, 2400, 0, true)
        for (i in 1 until 10) frame(m, 1080, 2400, i * 10_000L, false)
        m.encoderReplaced()
        m.videoFormat(fmt(1080, 2400))
        frame(m, 1080, 2400, 150_000, true)
        for (i in 16 until 20) frame(m, 1080, 2400, i * 10_000L, false)
        m.finish()
        assertEquals(1, sink.files.size)
        assertEquals(15, sink.files[0].frames.size)
    }

    @Test fun aReplacedEncoderWithOtherHeadersStartsANewPart() {
        val sink = FakeSink()
        val ev = Events()
        val m = SegMuxer(sink, false, Long.MAX_VALUE, "RawRec enc2", ev)
        m.videoFormat(fmt(1080, 2400, csd = 1))
        frame(m, 1080, 2400, 0, true)
        for (i in 1 until 10) frame(m, 1080, 2400, i * 10_000L, false)
        m.encoderReplaced()
        m.videoFormat(fmt(1080, 2400, csd = 2))
        frame(m, 1080, 2400, 150_000, true)
        for (i in 16 until 20) frame(m, 1080, 2400, i * 10_000L, false)
        m.finish()
        assertEquals(2, sink.files.size)
        assertEquals(10, sink.files[0].frames.size)
        assertEquals(5, sink.files[1].frames.size)
        assertTrue(ev.opened.contains(2 to SegMuxer.REASON_RECOVER))
    }

    @Test fun stopReasonsSayWhoEndedTheRecording() {
        for (r in listOf(StopReason.CONTROL, StopReason.APP, StopReason.NOTIFICATION, StopReason.TILE, StopReason.SHAKE)) assertTrue(r.byUser)
        for (r in listOf(StopReason.SCREEN_LOCKED, StopReason.PROJECTION_ENDED, StopReason.ENCODER_ERROR, StopReason.WRITE_ERROR,
            StopReason.PROCESS_DIED, StopReason.CRASH, StopReason.LOW_STORAGE)) assertFalse(r.byUser)
        assertEquals(StopReason.SCREEN_LOCKED, StopReason.of("SCREEN_LOCKED"))
        assertNull(StopReason.of("nonsense"))
    }
}
