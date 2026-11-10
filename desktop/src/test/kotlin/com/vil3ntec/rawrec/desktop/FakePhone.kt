package com.vil3ntec.rawrec.desktop

import org.bytedeco.ffmpeg.avformat.AVFormatContext
import org.bytedeco.ffmpeg.global.avcodec.av_packet_alloc
import org.bytedeco.ffmpeg.global.avcodec.av_packet_free
import org.bytedeco.ffmpeg.global.avcodec.av_packet_unref
import org.bytedeco.ffmpeg.global.avformat.*
import org.bytedeco.javacpp.Pointer
import java.io.DataOutputStream
import java.io.File
import java.net.ServerSocket
import kotlin.math.PI
import kotlin.math.sin

/**
 * A phone for tests: speaks scrcpy's protocol on the port the app forwards to (the fake adb writes it
 * to [portFile]), sends the frames of a real H.264 stream at [fps] in real time, and 20 ms of a 440 Hz
 * tone at a time on the second connection — as the phone-side server does.
 */
class FakePhone(private val h264: File, private val portFile: File, private val fps: Int, private val name: String = "Fake Phone") {
    @Volatile var sentFrames = 0; private set

    fun runInBackground() = Thread({ run() }, "fake-phone").apply { isDaemon = true; start() }

    private fun run() {
        while (!portFile.exists() || portFile.readText().isBlank()) Thread.sleep(20)
        val port = portFile.readText().trim().toInt()
        ServerSocket(port, 2, java.net.InetAddress.getByName("127.0.0.1")).use { ss ->
            val v = ss.accept()
            val vo = DataOutputStream(v.getOutputStream().buffered())
            vo.writeByte(0); vo.flush()                                  // dummy byte, at once
            val a = ss.accept()                                          // as the real server: the name only
            vo.write(name.toByteArray().copyOf(64)); vo.flush()          // once every connection is open
            Thread({ audio(DataOutputStream(a.getOutputStream().buffered())) }, "fake-audio").apply { isDaemon = true; start() }
            vo.writeInt(PhoneLink.CODEC_H264); vo.writeInt(0); vo.writeInt(0)
            val ic = AVFormatContext(null as Pointer?)
            check(avformat_open_input(ic, h264.absolutePath, null, null) >= 0)
            val pkt = av_packet_alloc()
            val t0 = System.nanoTime()
            var n = 0
            try {
                while (av_read_frame(ic, pkt) >= 0) {
                    val data = ByteArray(pkt.size()); pkt.data().get(data)
                    val ptsUs = n * 1_000_000L / fps
                    val wait = t0 + ptsUs * 1000 - System.nanoTime()
                    if (wait > 0) Thread.sleep(wait / 1_000_000, (wait % 1_000_000).toInt())
                    vo.write(PhoneLink.frame(ptsUs, false, (pkt.flags() and 1) != 0, data)); vo.flush()
                    av_packet_unref(pkt)
                    n++; sentFrames = n
                }
            } catch (_: Exception) {}
            av_packet_free(pkt); avformat_close_input(ic)
            Thread.sleep(300)
            v.close(); a.close()
        }
    }

    private fun audio(o: DataOutputStream) {
        try {
            o.writeInt(PhoneLink.CODEC_RAW); o.flush()
            val t0 = System.nanoTime()
            var k = 0L
            while (true) {
                val pts = k * 20_000
                val wait = t0 + pts * 1000 - System.nanoTime()
                if (wait > 0) Thread.sleep(wait / 1_000_000)
                val n = 960   // 20 ms at 48 kHz
                val b = ByteArray(n * 4)
                for (i in 0 until n) {
                    val s = (sin(2 * PI * 440 * (k * n + i) / 48_000.0) * 8000).toInt()
                    b[i * 4] = s.toByte(); b[i * 4 + 1] = (s shr 8).toByte(); b[i * 4 + 2] = s.toByte(); b[i * 4 + 3] = (s shr 8).toByte()
                }
                o.write(PhoneLink.frame(pts, false, false, b)); o.flush()
                k++
            }
        } catch (_: Exception) {}
    }
}
