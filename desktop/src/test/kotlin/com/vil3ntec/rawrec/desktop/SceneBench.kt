package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.*
import org.jetbrains.skia.*

/** How long the engine takes to draw typical scenes at 1080p (no other load), and the studio-mode extra. */
fun main(args: Array<String>) {
    val img = args[0]
    val src = listOf(SourceDef("bg", SourceKind.COLOR, "bg", mapOf("color" to "#0F172A", "color2" to "#1E3A5F")),
        SourceDef("cam", SourceKind.IMAGE, "cam", mapOf("path" to img)),
        SourceDef("t", SourceKind.TEXT, "t", mapOf("text" to "زنده — RawRec", "size" to "46", "bg" to "#99000000")),
        SourceDef("c", SourceKind.CHAT, "c", mapOf("size" to "28")))
    for (i in 0 until 30) ChatHub.add(ChatMessage("m$i", Platform.TWITCH, "user$i", "پیامِ شمارهٔ $i — hello 👋"))
    val talk = Scene("talk", "talk", listOf(Layer("1", "bg", 0f, 0f, 1920f, 1080f), Layer("2", "cam", 460f, 140f, 1000f, 740f, fx = Fx(key = true)),
        Layer("3", "c", 1380f, 120f, 500f, 840f), Layer("4", "t", 560f, 30f, 800f, 80f)))
    val st = Studio(1920, 1080, 60, src, listOf(talk), "talk")
    Engine(st, { null }, autostart = false).use { e ->
        val s = Surface.makeRasterN32Premul(1920, 1080)
        repeat(20) { e.drawProgram(s.canvas, st) }
        val t = System.nanoTime(); repeat(60) { e.drawProgram(s.canvas, st) }
        println("BENCH talk scene 1080p: %.1f ms a picture".format((System.nanoTime() - t) / 1e6 / 60))
        for (l in talk.layers) {
            val one = st.copy(scenes = listOf(talk.copy(layers = listOf(l))))
            repeat(10) { e.drawProgram(s.canvas, one) }
            val t1 = System.nanoTime(); repeat(40) { e.drawProgram(s.canvas, one) }
            println("BENCH layer ${l.sourceId}: %.1f ms".format((System.nanoTime() - t1) / 1e6 / 40))
        }
        val empty = st.copy(scenes = listOf(talk.copy(layers = emptyList())))
        val t3 = System.nanoTime(); repeat(40) { e.drawProgram(s.canvas, empty) }
        println("BENCH empty: %.1f ms".format((System.nanoTime() - t3) / 1e6 / 40))
        val n = Surface.makeRasterN32Premul(1280, 720)
        val t2 = System.nanoTime(); repeat(60) { n.canvas.save(); n.canvas.scale(1280f / 1920, 1280f / 1920); e.drawScene(n.canvas, st, talk); n.canvas.restore() }
        println("BENCH studio-mode extra (720p): %.1f ms".format((System.nanoTime() - t2) / 1e6 / 60))
    }
    System.exit(0)
}
