package com.vil3ntec.rawrec.desktop

import com.vil3ntec.rawrec.desktop.studio.*
import org.bytedeco.ffmpeg.avformat.AVFormatContext
import org.bytedeco.ffmpeg.global.avformat.*
import org.bytedeco.javacpp.Pointer
import org.jetbrains.skia.*
import java.io.File
import java.nio.ByteBuffer
import kotlin.math.abs
import kotlin.math.sin
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertTrue

class StudioFeaturesTest {
    private val tmp = kotlin.io.path.createTempDirectory("studio").toFile()

    /** A 200×100 picture: green all over (a darker green band at the bottom, as a shaded screen), and patches of other colours. */
    private val patches = listOf(0xFFFF0000.toInt() to 25, 0xFFD2A082.toInt() to 65, 0xFFFFFFFF.toInt() to 105, 0xFF283C8C.toInt() to 145)  // red, skin, white, denim
    private fun greenWithRed(): File {
        val s = Surface.makeRasterN32Premul(200, 100)
        s.canvas.clear(0xFF00FF00.toInt())
        Paint().use { p -> p.color = 0xFF1E9628.toInt(); s.canvas.drawRect(Rect.makeXYWH(0f, 80f, 200f, 20f), p) }
        for ((c, x) in patches) Paint().use { p -> p.color = c; s.canvas.drawRect(Rect.makeXYWH(x.toFloat(), 25f, 30f, 40f), p) }
        val f = File(tmp, "g.png"); f.writeBytes(s.makeImageSnapshot().encodeToData(EncodedImageFormat.PNG)!!.bytes); return f
    }

    private fun studioWith(fx: Fx, path: String): Studio {
        val src = SourceDef("img", SourceKind.IMAGE, "i", mapOf("path" to path))
        val l = Layer("l", "img", 0f, 0f, 200f, 100f, fit = Fit.STRETCH, fx = fx)
        val sc = Scene("s", "s", listOf(l))
        return Studio(200, 100, 30, listOf(src), listOf(sc), "s")
    }

    private fun render(st: Studio, e: Engine): Bitmap {
        val s = Surface.makeRasterN32Premul(st.width, st.height)
        e.drawProgram(s.canvas, st)
        val b = Bitmap(); b.allocN32Pixels(st.width, st.height); s.readPixels(b, 0, 0); return b
    }

    private fun rgb(c: Int) = Triple((c shr 16) and 0xFF, (c shr 8) and 0xFF, c and 0xFF)

    @Test fun greenScreenRemovesTheGreenAndKeepsTheRest() {
        val st = studioWith(Fx(key = true), greenWithRed().absolutePath)
        Engine(st, { null }, autostart = false).use { e ->
            val b = render(st, e)
            println("green screen: green=${rgb(b.getColor(10, 10))} shaded=${rgb(b.getColor(10, 90))} " + patches.joinToString { (c, x) -> "${rgb(c)}→${rgb(b.getColor(x + 15, 45))}" })
            for (p in listOf(10 to 10, 190 to 10, 10 to 90, 100 to 90)) { val (r, g, bb) = rgb(b.getColor(p.first, p.second)); assertTrue(r + g + bb < 40, "green left at $p: ${rgb(b.getColor(p.first, p.second))}") }
            for ((c, x) in patches) {
                val want = rgb(c); val got = rgb(b.getColor(x + 15, 45))
                assertTrue(abs(want.first - got.first) + abs(want.second - got.second) + abs(want.third - got.third) < 60, "colour ${want} became $got")
            }
        }
    }

    @Test fun greenScreenIsFastEnoughForLiveVideo() {
        val w = 1280; val h = 720
        val px = ByteArray(w * h * 4) { i -> when (i % 4) { 1 -> -1; 3 -> -1; else -> if (i % 4 == 0 && (i / 4) % w > 600) 100 else 0 } }
        FxFilter().use { f ->
            repeat(5) { f.apply(px, w, h, Fx(key = true, sharpen = 0.3f)) }
            val t = System.nanoTime(); repeat(30) { f.apply(px, w, h, Fx(key = true, sharpen = 0.3f)) }
            val ms = (System.nanoTime() - t) / 1e6 / 30
            println("green screen + sharpen 1280×720: %.1f ms a picture".format(ms))
            // the budget: a 30 fps webcam keyed on its own thread (this test machine is a small shared VM)
            assertTrue(ms < 33, "too slow for 30 fps: $ms ms")
        }
    }

    @Test fun colourCorrectionChangesThePicture() {
        val path = greenWithRed().absolutePath
        val plain = studioWith(Fx(), path); val grey = studioWith(Fx(saturation = 0f), path); val bright = studioWith(Fx(brightness = 0.3f, contrast = 1f), path)
        Engine(plain, { null }, autostart = false).use { e ->
            val (r, g, b) = rgb(render(grey, e).getColor(40, 45))
            assertTrue(abs(r - g) < 6 && abs(g - b) < 6, "not grey: $r $g $b")
            val (r0, _, b0) = rgb(render(plain, e).getColor(40, 45)); val (_, _, b1) = rgb(render(bright, e).getColor(40, 45))
            assertTrue(r0 > 240 && b0 < 10 && b1 > 60, "brightness not applied: $b0 → $b1")
        }
    }

    @Test fun fadeTransitionMixesTheTwoScenes() {
        val red = SourceDef("r", SourceKind.COLOR, "r", mapOf("color" to "#FF0000")); val blue = SourceDef("b", SourceKind.COLOR, "b", mapOf("color" to "#0000FF"))
        val a = Scene("a", "a", listOf(Layer("la", "r", 0f, 0f, 100f, 100f))); val bb = Scene("b", "b", listOf(Layer("lb", "b", 0f, 0f, 100f, 100f)))
        val s1 = Studio(100, 100, 30, listOf(red, blue), listOf(a, bb), "a", Transition.FADE, 1000)
        Engine(s1, { null }, autostart = false).use { e ->
            val surf = Surface.makeRasterN32Premul(100, 100)
            val t0 = System.nanoTime()
            e.drawProgram(surf.canvas, s1, t0)
            val s2 = s1.copy(current = "b")
            e.drawProgram(surf.canvas, s2, t0 + 1)                  // the switch
            e.drawProgram(surf.canvas, s2, t0 + 500_000_000L)       // halfway
            val bm = Bitmap(); bm.allocN32Pixels(100, 100); surf.readPixels(bm, 0, 0)
            val (r, _, b) = rgb(bm.getColor(50, 50))
            println("fade halfway: r=$r b=$b")
            assertTrue(r in 90..170 && b in 90..170, "not a mix: $r $b")
            e.drawProgram(surf.canvas, s2, t0 + 1_100_000_000L)     // done
            val bm2 = Bitmap(); bm2.allocN32Pixels(100, 100); surf.readPixels(bm2, 0, 0)
            assertEquals(Triple(0, 0, 255), rgb(bm2.getColor(50, 50)))
        }
    }

    private fun tone(freq: Double, amp: Double, ms: Int, noise: Double = 0.0): ByteArray {
        val n = 48 * ms; val b = ByteArray(n * 4); val rnd = java.util.Random(7)
        for (i in 0 until n) {
            val v = (amp * sin(2 * Math.PI * freq * i / 48_000) + noise * (rnd.nextDouble() * 2 - 1)) * 32767
            val s = v.toInt().coerceIn(-32768, 32767)
            b[i * 4] = s.toByte(); b[i * 4 + 1] = (s shr 8).toByte(); b[i * 4 + 2] = s.toByte(); b[i * 4 + 3] = (s shr 8).toByte()
        }
        return b
    }

    /** The mix of one input for [ms]: sound coming in 10 ms at a time (as a microphone) and mixed 10 ms at a time. */
    private fun through(fx: AudioFx, pcm: ByteArray, ms: Int): IntArray {
        val inp = AudioInput("t"); inp.fx = fx
        val out = ArrayList<Int>()
        for (i in 0 until ms / 10) {
            val from = i * 1920
            if (from + 1920 <= pcm.size) inp.push(pcm.copyOfRange(from, from + 1920))
            val m = IntArray(960); inp.mixInto(m, 480); out.addAll(m.toList())
        }
        inp.close()
        return out.toIntArray()
    }
    private fun rms(a: IntArray, from: Int = 0) = Math.sqrt(a.drop(from).sumOf { it.toDouble() * it } / (a.size - from).coerceAtLeast(1)) / 32768

    @Test fun gateSilencesNoiseAndLetsSpeechThrough() {
        val quiet = through(AudioFx(gate = true, gateDb = -40f), tone(300.0, 0.003, 600), 500)      // ≈ -50 dB: hiss
        val loud = through(AudioFx(gate = true, gateDb = -40f), tone(300.0, 0.3, 600), 500)         // ≈ -10 dB: a voice
        println("gate: quiet ${rms(quiet, 24000)} loud ${rms(loud, 24000)}")
        assertTrue(rms(quiet, 24000) < 0.0005, "noise passed the gate")
        assertTrue(rms(loud, 24000) > 0.15, "speech was cut")
    }

    @Test fun compressorEvensOutLoudness() {
        val loud = rms(through(AudioFx(comp = true, compDb = -20f, ratio = 4f), tone(300.0, 0.9, 600), 500), 24000)
        val soft = rms(through(AudioFx(comp = true, compDb = -20f, ratio = 4f), tone(300.0, 0.09, 600), 500), 24000)
        println("compressor: loud $loud soft $soft (in: 10× apart)")
        assertTrue(loud / soft < 5.5, "not compressed: ${loud / soft}")
    }

    /** Pink-ish noise as a fan or a room makes it, about −45 dB. */
    private fun roomNoise(ms: Int): ByteArray {
        val n = 48 * ms; val b = ByteArray(n * 4); val rnd = java.util.Random(3); var a = 0.0; var c = 0.0
        for (i in 0 until n) {
            val w = rnd.nextGaussian(); a = 0.97 * a + 0.03 * w; c = 0.6 * c + 0.4 * w
            val v = ((a * 1.2 + c * 0.25) * 0.02 * 32767).toInt().coerceIn(-32768, 32767)
            b[i * 4] = v.toByte(); b[i * 4 + 1] = (v shr 8).toByte(); b[i * 4 + 2] = v.toByte(); b[i * 4 + 3] = (v shr 8).toByte()
        }
        return b
    }

    @Test fun noiseSuppressionTakesOutRoomNoise() {
        val noise = roomNoise(3200)
        val before = rms(through(AudioFx(), noise, 3000).let { it.copyOfRange(it.size / 2, it.size) })
        val after = rms(through(AudioFx(denoise = true, denoisePct = 100), noise, 3000).let { it.copyOfRange(it.size / 2, it.size) })
        val db = 20 * Math.log10(after / before)
        println("denoise (RNNoise): noise ${"%.1f".format(20 * Math.log10(before))} dB → ${"%.1f".format(20 * Math.log10(after.coerceAtLeast(1e-9)))} dB (${"%.1f".format(db)} dB)")
        assertTrue(db < -10, "only $db dB taken out")
    }

    @Test fun limiterKeepsTheMixUnderMinusOneDb() {
        var peak = 0
        val mixer = AudioMixer { pcm, _ -> for (i in pcm.indices step 2) peak = maxOf(peak, abs(((pcm[i].toInt() and 0xFF) or (pcm[i + 1].toInt() shl 8)).toShort().toInt())) }
        val a = mixer.input("a"); val b = mixer.input("b")
        mixer.start(System.nanoTime())
        repeat(30) { a.push(tone(200.0, 0.8, 20)); b.push(tone(200.0, 0.8, 20)); Thread.sleep(19) }
        Thread.sleep(200); mixer.close()
        println("limiter: peak ${peak / 32768.0}")
        assertTrue(peak in 1..(32768 * 0.9).toInt(), "peak $peak")
    }

    private fun frame(w: Int, h: Int, pts: Long, shade: Int): VideoFrame {
        val b = ByteBuffer.allocateDirect(w * h * 4); for (i in 0 until w * h) { b.put(shade.toByte()); b.put(80); b.put((255 - shade).toByte()); b.put(-1) }; b.flip()
        return VideoFrame(w, h, b, pts)
    }
    private fun duration(f: File): Double { val ic = AVFormatContext(null as Pointer?); avformat_open_input(ic, f.absolutePath, null, null); avformat_find_stream_info(ic, null as org.bytedeco.javacpp.PointerPointer<*>?); val d = ic.duration() / 1e6; avformat_close_input(ic); return d }

    @Test fun pausedTimeIsLeftOutOfTheFile() {
        val enc = Encoders.available().first { !it.hardware && it.family == Encoders.Family.H264 }
        val r = Recording(enc, 180, 30, 800, withAudio = false, dir = tmp)
        r.start()
        var pts = 0L
        fun run(ms: Int) { repeat(ms / 33) { r.video(frame(320, 180, pts, 40)); pts += 33_333; Thread.sleep(33) } }
        run(1000); r.pause(); run(1500); r.resume(); run(1000)
        val res = r.stop()
        println("pause: ${res.seconds} s, ${res.frames} frames, file ${duration(res.file)} s")
        assertTrue(duration(res.file) in 1.7..2.4, "file ${duration(res.file)} s (the 1.5 s pause must be left out)")
    }

    @Test fun replayBufferSavesTheLastSecondsAndGoesOn() {
        val enc = Encoders.available().first { !it.hardware && it.family == Encoders.Family.H264 }
        val rb = ReplayBuffer(enc, 320, 180, 30, 800, seconds = 2, dir = tmp)
        var pts = 0L
        repeat(150) { i -> rb.video(frame(320, 180, pts, i)); rb.audio(tone(440.0, 0.2, 33), pts); pts += 33_333; Thread.sleep(33) }
        Thread.sleep(300)
        val f = rb.save()
        assertNotNull(f)
        val d = duration(f)
        println("replay: ${f.name} $d s (held ${rb.heldSeconds})")
        rb.stop()
        assertTrue(d in 1.9..4.2, "replay length $d")
    }

    @Test fun undoAndRedoAndOneStepForADrag() {
        val h = History()
        val a = Studio.default(); val b = a.copy(fps = 30); val c = b.copy(fps = 25)
        h.record(a, "drag", 0); h.record(b, "drag", 100)        // two moves of one drag
        assertEquals(a, h.undo(c)); assertEquals(c, h.redo(a))
        h.record(c, "x", 5000)
        assertTrue(h.canUndo)
    }

    @Test fun everythingNewIsSavedAndReadBack() {
        var s = Studio.default().copy(transition = Transition.SLIDE, transitionMs = 700)
        s = s.withLayer(s.scene.layers.first().copy(fx = Fx(key = true, saturation = 1.3f, sharpen = 0.4f)))
        s = s.add(SourceKind.GOAL, "هدف", mapOf("target" to "500")).first
        s = s.addScene("دوم").copy(preview = s.scenes.first().id)
        val back = Studio.fromJson(Studio.toJson(s))
        assertEquals(s, back)
    }

    @Test fun roundedCountsAreRead() {
        assertEquals(1200L, PlatformStats.parseShort("1.2K subscribers"))
        assertEquals(3_450_000L, PlatformStats.parseShort("3.45M"))
        assertEquals(987L, PlatformStats.parseShort("987 subscribers"))
        assertEquals("12.3K", PlatformStats.fmt(12_345))
    }

    @Test fun verticalSceneIsLaidOutSavedAndDeliveredOnItsOwnCanvas() {
        // the main scene: a colour background, the game, a chat on the side
        var s = Studio.default().copy(fps = 30)
        s = s.add(SourceKind.COLOR, "bg", mapOf("color" to "#FF0000FF")).first
        s = s.withScene(s.scene.copy(layers = listOf(s.scene.layers.last()) + s.scene.layers.dropLast(1)))
        s = s.add(SourceKind.CHAT, "chat").first
        s = s.addVerticalScene("عمودی")
        val v = assertNotNull(s.verticalScene)
        assertTrue(v.vertical && s.editing.id == v.id && s.scene.id != v.id, "vertical opened for editing, main program unchanged")
        val chat = v.layers.first { s.source(it.sourceId)?.kind == SourceKind.CHAT }
        val game = v.layers.first { s.source(it.sourceId)?.kind == SourceKind.PHONE }
        assertTrue(game.w == 1080f && chat.y >= game.y + game.h && chat.y + chat.h <= 1920f, "game across the top, chat below: $game / $chat")
        // a main scene opened again: the vertical one stays on its output
        val s2 = s.open(s.scene.id)
        assertEquals(v.id, s2.vertical); assertTrue(!s2.editing.vertical)
        assertEquals(s, Studio.fromJson(Studio.toJson(s)))
        // a new source added while the vertical scene is edited lands inside the upright canvas
        val (s3, l3) = s.add(SourceKind.TEXT, "t")
        assertTrue(l3.x + l3.w <= 1080f && s3.verticalScene!!.layers.any { it.id == l3.id })
        // the engine: every tick a 1080×1920 picture to the vertical outputs, the same ticks as the main picture
        val got = java.util.concurrent.CopyOnWriteArrayList<Triple<Int, Int, Long>>(); val main = java.util.concurrent.CopyOnWriteArrayList<Long>()
        var blue = 0
        Engine(s2, { null }).use { e ->
            e.vOutputs.add(object : Output {
                override fun video(f: com.vil3ntec.rawrec.desktop.VideoFrame) {
                    got.add(Triple(f.width, f.height, f.ptsUs))
                    if (got.size == 10) { val b = f.bgra.duplicate(); b.position((960 * f.width + 540) * 4); blue = b.get().toInt() and 0xFF }
                }
                override fun audio(pcm: ByteArray, ptsUs: Long) {}
            })
            e.outputs.add(object : Output {
                override fun video(f: com.vil3ntec.rawrec.desktop.VideoFrame) { main.add(f.ptsUs) }
                override fun audio(pcm: ByteArray, ptsUs: Long) {}
            })
            Thread.sleep(1500)
        }
        println("vertical: ${got.size} pictures in 1.5 s, first ${got.firstOrNull()}")
        assertTrue(got.size >= 35, "vertical frames ${got.size}")
        assertTrue(got.all { it.first == 1080 && it.second == 1920 })
        assertTrue(got.map { it.third }.toSet().intersect(main.toSet()).size >= got.size - 2, "same clock as the main picture")
        assertTrue(blue > 200, "the background drawn on the upright canvas (blue=$blue)")
    }

    @Test fun mainPictureFromPhoneComputerOrBoth() {
        var s = Studio.default()
        s = s.add(SourceKind.COLOR, "bg").first.let { st -> st.withScene(st.scene.copy(layers = listOf(st.scene.layers.last()) + st.scene.layers.dropLast(1))) }
        s = s.add(SourceKind.TEXT, "title", mapOf("text" to "سلام")).first
        assertEquals(Studio.MainFrom.PHONE, s.mainFrom)
        val pc = s.useMain(Studio.MainFrom.COMPUTER)
        assertEquals(Studio.MainFrom.COMPUTER, pc.mainFrom)
        val kinds = pc.scene.layers.map { pc.source(it.sourceId)!!.kind }
        assertEquals(listOf(SourceKind.COLOR, SourceKind.SCREEN, SourceKind.TEXT), kinds, "background under, the screen in the middle, the title on top")
        val both = pc.useMain(Studio.MainFrom.BOTH)
        assertEquals(Studio.MainFrom.BOTH, both.mainFrom)
        assertEquals(1, both.sources.count { it.kind == SourceKind.SCREEN }, "the same screen source reused, never a second capture")
        val phone = both.scene.layers.first { both.source(it.sourceId)!!.kind == SourceKind.PHONE }
        assertTrue(phone.w < both.width * 0.5f && phone.x < both.width / 2f && phone.y > both.height / 2f, "phone small in the lower-left corner")
        assertEquals(Studio.MainFrom.PHONE, both.useMain(Studio.MainFrom.PHONE).mainFrom)
        assertEquals(both, Studio.fromJson(Studio.toJson(both)))
    }
}
