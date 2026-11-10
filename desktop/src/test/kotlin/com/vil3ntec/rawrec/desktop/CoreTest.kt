package com.vil3ntec.rawrec.desktop

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CoreTest {
    @Test fun adbDeviceListIsRead() {
        val out = """
            List of devices attached
            R5CT31ABCDE            device usb:1-1 product:astra model:RedMagic_Astra device:astra transport_id:3
            emulator-5554          unauthorized transport_id:4
            * daemon started successfully
        """.trimIndent()
        val d = Adb.parseDevices(out)
        assertEquals(2, d.size)
        assertEquals("RedMagic Astra (R5CT31ABCDE)", d[0].label)
        assertTrue(d[0].usable)
        assertFalse(d[1].usable)
        assertEquals("unauthorized", d[1].state)
    }

    @Test fun scrcpyPacketHeaderCarriesTheFlags() {
        val b = PhoneLink.frame(123_456, config = false, key = true, data = byteArrayOf(1, 2, 3))
        val bb = java.nio.ByteBuffer.wrap(b)
        val pts = bb.long
        assertEquals(1L shl 62, pts and (1L shl 62), "key-frame bit")
        assertEquals(0L, pts and (1L shl 63), "not a configuration packet")
        assertEquals(123_456L, pts and ((1L shl 62) - 1))
        assertEquals(3, bb.int)
        assertEquals("hevc", PhoneLink.codecName(PhoneLink.CODEC_H265))
    }

    @Test fun eachGraphicsCardGetsItsOwnQualityWords() {
        assertTrue(VideoEncoder.options("hevc_nvenc", true).contains("tune" to "hq"))
        assertTrue(VideoEncoder.options("h264_nvenc", false).contains("zerolatency" to "1"))
        assertTrue(VideoEncoder.options("h264_amf", true).contains("quality" to "quality"))
        assertTrue(VideoEncoder.options("hevc_qsv", true).isNotEmpty())
        assertTrue(VideoEncoder.options("h264_videotoolbox", true).contains("allow_sw" to "0"))
    }

    @Test fun bundledAdbWithoutRunMarkIsCopiedAndMadeRunnable() {
        val dir = kotlin.io.path.createTempDirectory("rr").toFile()
        val b = File(dir, "app/adb").apply { parentFile.mkdirs(); writeText("#!/bin/sh\necho ok\n"); setExecutable(false, false) }
        val r = Adb.runnable(b, File(dir, "data"))
        if (System.getProperty("os.name").lowercase().contains("win")) return
        assertTrue(r.canExecute(), "copy must be runnable")
        assertEquals(File(dir, "data/platform-tools/adb"), r)
        assertEquals("#!/bin/sh\necho ok\n", r.readText())
        assertEquals(r, Adb.runnable(b, File(dir, "data")))   // reused, not copied again
        dir.deleteRecursively()
    }
}
