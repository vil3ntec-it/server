package com.vil3ntec.rawrec.desktop

import java.io.File

/**
 * `RawRec --selftest [seconds] [codec]`: the app's own check, without its window — finds adb and the
 * first phone, links it as the window does (the same [Session]), records for [seconds] with the best
 * encoder of this computer, and prints what came out. Exit 0 only when a real file with pictures came out.
 */
object SelfTest {
    /** Also into a file when -Drawrec.selftestOut=<path> is given: the Windows launcher has no console. */
    private val log: java.io.PrintWriter? = System.getProperty("rawrec.selftestOut")?.let { java.io.PrintWriter(java.io.FileWriter(it), true) }
    private fun println(s: String) { kotlin.io.println(s); log?.println(s) }

    fun run(args: List<String>): Int = try { runIt(args) } catch (e: Throwable) { println("FAIL: ${e.javaClass.simpleName}: ${e.message}"); 3 } finally { log?.flush() }

    private fun runIt(args: List<String>): Int {
        val seconds = args.getOrNull(0)?.toIntOrNull() ?: 10
        val codec = args.getOrNull(1) ?: "h264"
        println("rawrec-desktop selftest: os ${System.getProperty("os.name")} ${System.getProperty("os.arch")}, java ${System.getProperty("java.version")}")
        val encs = Encoders.available()
        println("encoders: " + encs.joinToString { it.name + if (it.hardware) "(gpu)" else "(cpu)" })
        val enc = Encoders.best() ?: return fail("no working video encoder")
        val adb = Adb.find() ?: return fail("adb not found")
        println("adb: ${adb.exe}")
        val dev = adb.devices().firstOrNull { it.usable } ?: return fail("no usable phone: ${adb.devices()}")
        println("phone: ${dev.label}, Android SDK ${adb.sdk(dev.serial)}")
        val s = Session(adb)
        s.connect(dev.serial, PhoneLink.Options(codec = codec, bitRateMbps = 20, maxFps = 60, audio = true))
        val t0 = System.currentTimeMillis()
        while (s.state.phase != Session.Phase.LIVE && System.currentTimeMillis() - t0 < 20_000) Thread.sleep(100)
        if (s.state.phase != Session.Phase.LIVE) return fail("link: ${s.state.error ?: s.state.phase}")
        println("live: ${s.state.device} ${s.state.codec} ${s.state.width}x${s.state.height}")
        // wait for the first picture before recording (the phone sends one as soon as its screen changes)
        while (s.latest.get() == null && System.currentTimeMillis() - t0 < 25_000) Thread.sleep(50)
        s.startRecording(enc, 720, 30, 6000, audio = true)
        for (i in 1..seconds) {
            Thread.sleep(1000)
            val st = s.state
            println("t=${i}s in: ${st.fps} fps ${"%.1f".format(st.mbps)} Mbps ${st.width}x${st.height} audio=${st.audio} rec: ${st.recBytes} bytes dropped ${st.recDropped}")
        }
        val r = s.stopRecording() ?: return fail("no recording")
        s.disconnect()
        println("result: ${r.file.absolutePath} ${r.width}x${r.height} ${"%.2f".format(r.seconds)}s frames=${r.frames} dropped=${r.dropped} bytes=${r.bytes} encoder=${r.encoder} error=${r.error}")
        println("RESULT_FILE=${r.file.absolutePath}")
        return if (r.error == null && r.frames > 0 && File(r.file.absolutePath).length() > 0) 0 else 1
    }

    private fun fail(msg: String): Int { println("FAIL: $msg"); return 2 }
}
