package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.*
import java.io.File

/**
 * Live to two platforms at once, for real, without a phone: a scene (a moving video, a text, a colour)
 * streamed by the studio to two RTMP servers (ffmpeg listeners standing in for YouTube and Twitch) — the second gets
 * the upright 9:16 picture (a vertical scene made from the main one), as a Shorts key would.
 * Args: videoFile, seconds, url1, url2. Run with -Duser.home=<temp> so the owner's settings are not touched.
 */
fun main(args: Array<String>) {
    val video = args[0]; val seconds = args[1].toInt()
    val app = StudioApp(null, File(System.getProperty("user.home"), "studio-live.json"), File(System.getProperty("user.home"), "settings-live.json"))
    var s = Studio.default().copy(fps = 30)
    s = s.add(SourceKind.COLOR, "پس‌زمینه", mapOf("color" to "#0F172A", "color2" to "#1E3A5F")).first
    s = s.add(SourceKind.VIDEO, "بازی", mapOf("path" to video)).first.let { st ->
        st.withLayer(st.scene.layers.last().copy(x = 160f, y = 90f, w = 1600f, h = 900f))
    }
    s = s.add(SourceKind.TEXT, "عنوان", mapOf("text" to "آزمونِ پخشِ زنده — RawRec", "size" to "56", "bg" to "#99000000")).first
    s = s.addVerticalScene("عمودی").let { it.open(it.scene.id) }
    app.studio = s
    app.update { it.copy(liveKbps = 4500, dests = listOf(
        Destination("a", Platform.YOUTUBE, "سرورِ ۱", args[2].substringBeforeLast('/'), Secrets.seal(args[2].substringAfterLast('/'))),
        Destination("b", Platform.YOUTUBE, "سرورِ ۲", args[3].substringBeforeLast('/'), Secrets.seal(args[3].substringAfterLast('/')), vertical = true),
    )) }
    Thread.sleep(1500)
    app.startLive()?.let { println("FAIL: $it"); System.exit(2) }
    for (i in 1..seconds) {
        Thread.sleep(1000)
        val l = app.live; val v = app.vLive
        println("t=${i}s engine ${app.engine.fps} fps draw ${"%.1f".format(app.engine.drawMs)} ms (vertical ${"%.1f".format(app.engine.vDrawMs)} ms); " +
            listOfNotNull(l, v).flatMap { it.perDest }.joinToString(" | ") { d -> "${d.name}: ${d.status?.let { st -> "${st.state} ${st.kbps}kbps ${st.fps}fps lag ${st.lagMs}ms" } ?: "-"}" } +
            " dropped ${l?.dropped}/${v?.dropped} error ${l?.error}/${v?.error}")
    }
    app.stopLive()
    Thread.sleep(3000)
    app.close()
    println("LIVE_DONE")
    System.exit(0)
}
