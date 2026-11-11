package com.vil3ntec.rawrec.desktop

import org.bytedeco.ffmpeg.avformat.AVFormatContext
import org.bytedeco.ffmpeg.global.avformat.*
import org.bytedeco.ffmpeg.global.avutil.AVMEDIA_TYPE_VIDEO
import org.bytedeco.javacpp.Pointer
import java.io.File
import java.nio.ByteBuffer
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class RecordingTest {
    private fun picture(w: Int, h: Int, ptsUs: Long, shade: Int): VideoFrame {
        val b = ByteBuffer.allocateDirect(w * h * 4)
        for (i in 0 until w * h) { b.put(shade.toByte()); b.put((255 - shade).toByte()); b.put(0x40); b.put(-1) }
        b.flip()
        return VideoFrame(w, h, b, ptsUs)
    }

    /** A still screen (the phone sends nothing) still fills the file at the chosen rate, until «stop». */
    @Test fun stillScreenIsFilledAtTheChosenRateUntilStop() {
        val enc = Encoders.available().firstOrNull { !it.hardware && it.family == Encoders.Family.H264 } ?: return
        val dir = kotlin.io.path.createTempDirectory("rec").toFile()
        val r = Recording(enc, 360, 30, 1500, withAudio = false, dir = dir)
        r.start()
        val t0 = System.nanoTime()
        r.video(picture(640, 360, 5_000_000, 30))              // the phone's clock does not start at 0
        Thread.sleep(2000)
        r.video(picture(640, 360, 7_000_000, 200))             // 2 s later, one change
        Thread.sleep(1000)
        val res = r.stop()
        val wall = (System.nanoTime() - t0) / 1e9
        println("still screen: ${res.frames} frames, ${res.seconds} s, dropped ${res.dropped}, wall ${"%.2f".format(wall)} s, ${res.encoder}")
        assertNull(res.error)
        // ~3 s at 30 frames a second, not 2 pictures
        assertTrue(res.frames in 85..95, "frames ${res.frames} in ${"%.2f".format(wall)} s")
        assertTrue(res.seconds in 2.8..3.3, "seconds ${res.seconds}")
        assertEquals(0, res.dropped)
        // the file says so too
        val ic = AVFormatContext(null as Pointer?)
        check(avformat_open_input(ic, res.file.absolutePath, null, null) >= 0)
        avformat_find_stream_info(ic, null as org.bytedeco.javacpp.PointerPointer<*>?)
        val v = (0 until ic.nb_streams()).map { ic.streams(it) }.first { it.codecpar().codec_type() == AVMEDIA_TYPE_VIDEO }
        val dur = ic.duration() / 1e6
        avformat_close_input(ic)
        assertTrue(dur in 2.8..3.4, "file lasts $dur s")
        assertEquals(30, v.avg_frame_rate().num() / maxOf(1, v.avg_frame_rate().den()),
            "file rate (${res.file.name}: avg ${v.avg_frame_rate().num()}/${v.avg_frame_rate().den()} r ${v.r_frame_rate().num()}/${v.r_frame_rate().den()} frames ${v.nb_frames()} ${dur} s)")
        dir.deleteRecursively()
    }

    /**
     * A phone whose picture clock runs slow (seen on the emulator: 3 s of picture stamps over 14 s),
     * sound arriving all the time: the file still lasts as long as the recording, at the chosen rate.
     */
    @Test fun slowPictureClockStillGivesAFullLengthFile() {
        val enc = Encoders.available().firstOrNull { !it.hardware && it.family == Encoders.Family.H264 } ?: return
        val dir = kotlin.io.path.createTempDirectory("rec").toFile()
        val r = Recording(enc, 360, 30, 1500, withAudio = true, dir = dir)
        r.start()
        val t0 = System.nanoTime()
        val base = 9_000_000L
        val pcm = ByteArray(960 * 4)
        var nextPic = 0L; var k = 0L; var a = 0L
        while (System.nanoTime() - t0 < 5_000_000_000L) {
            val us = (System.nanoTime() - t0) / 1000
            if (us >= nextPic) { r.video(picture(640, 360, base + us / 4, (k * 40 % 250).toInt())); k++; nextPic += 700_000 }
            while (a * 20_000 <= us) { r.audio(pcm, base + a * 20_000); a++ }
            Thread.sleep(5)
        }
        val res = r.stop()
        println("slow clock: ${res.frames} frames, ${res.seconds} s, dropped ${res.dropped}, pictures $k")
        assertNull(res.error)
        assertTrue(res.seconds in 4.6..5.4, "seconds ${res.seconds}")
        assertTrue(res.frames in 138..162, "frames ${res.frames}")
        dir.deleteRecursively()
    }
}
