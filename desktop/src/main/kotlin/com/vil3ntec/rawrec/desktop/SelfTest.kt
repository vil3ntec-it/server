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
        org.bytedeco.ffmpeg.global.avdevice.avdevice_register_all()
        println("capture: " + listOf("gdigrab", "dshow", "avfoundation", "x11grab", "v4l2", "pulse").filter { org.bytedeco.ffmpeg.global.avformat.av_find_input_format(it) != null }.joinToString())
        println("noise model: ${com.vil3ntec.rawrec.desktop.studio.Denoiser.model()?.length() ?: "missing"} bytes")
        val encs = Encoders.available()
        println("encoders: " + encs.joinToString { it.name + if (it.hardware) "(gpu)" else "(cpu)" })
        val enc = Encoders.best() ?: return fail("no working video encoder")
        val adb = Adb.find() ?: return fail("adb not found")
        println("adb: ${adb.exe}")
        val dev = adb.devices().firstOrNull { it.usable } ?: return fail("no usable phone: ${adb.devices()}")
        println("phone: ${dev.label}, Android SDK ${adb.sdk(dev.serial)}")
        // the whole studio, as the window runs it: phone → scene (engine) → recording, on a fresh studio file
        val dir = java.nio.file.Files.createTempDirectory("rawrec-selftest").toFile()
        val app = com.vil3ntec.rawrec.desktop.studio.StudioApp(adb, File(dir, "studio.json"), File(dir, "settings.json"))
        try {
            app.studio = app.studio.copy(fps = 30)
            app.update { it.copy(phoneCodec = codec, phoneMbps = 20, phoneFps = 60, phoneAudio = true, recEncoder = enc.name, recHeight = 720, recKbps = 6000, mic = "") }
            app.connect(dev.serial)
            val s = app.session!!
            val t0 = System.currentTimeMillis()
            while (s.state.phase != Session.Phase.LIVE && System.currentTimeMillis() - t0 < 25_000) Thread.sleep(100)
            if (s.state.phase != Session.Phase.LIVE) return fail("link: ${s.state.error ?: s.state.phase}")
            println("live: ${s.state.device} ${s.state.codec} ${s.state.width}x${s.state.height}")
            while (s.latest.get() == null && System.currentTimeMillis() - t0 < 30_000) Thread.sleep(50)
            app.startRecording()?.let { return fail(it) }
            for (i in 1..seconds) {
                Thread.sleep(1000)
                val st = s.state; val r = app.recording
                println("t=${i}s in: ${st.fps} fps ${"%.1f".format(st.mbps)} Mbps ${st.width}x${st.height} audio=${st.audio} studio: ${app.engine.fps} fps draw ${"%.1f".format(app.engine.drawMs)} ms late ${app.engine.late} rec: ${r?.bytes} bytes dropped ${r?.dropped}")
            }
            val r = app.stopRecording() ?: return fail("no recording")
            println("result: ${r.file.absolutePath} ${r.width}x${r.height} ${"%.2f".format(r.seconds)}s frames=${r.frames} dropped=${r.dropped} bytes=${r.bytes} encoder=${r.encoder} error=${r.error}")
            println("RESULT_FILE=${r.file.absolutePath}")
            return if (r.error == null && r.frames > 0 && File(r.file.absolutePath).length() > 0) 0 else 1
        } finally {
            app.close()
            dir.deleteRecursively()
        }
    }

    private fun fail(msg: String): Int { println("FAIL: $msg"); return 2 }
}
