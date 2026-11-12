package com.vil3ntec.rawrec

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.ImageDecoder
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.SurfaceTexture
import android.graphics.drawable.AnimatedImageDrawable
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.media.MediaPlayer
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.view.Surface
import android.view.WindowManager
import java.io.File

/**
 * What viewers see over (or instead of) the game while streaming: the active scene of the
 * owner's [Scenes.Project], every visible layer drawn by [LayerPainter] or fed live (web pages,
 * videos, GIFs, the camera), handed to [LookFilter] as layers. Scenes switch at once (from the chat
 * panel), the «away» scene comes by itself when the game leaves the screen, and edits saved in
 * the editor while live apply immediately ([reload]). Main thread.
 */
class SceneRenderer(
    private val ctx: Context,
    private val filter: LookFilter,
    /** The scene's own background instead of the game (null = the game). */
    private val coverSink: (Bitmap?) -> Unit,
) : InPlaceEditor.Target {
    private val main = Handler(Looper.getMainLooper())
    val data = LayerPainter.Data()
    var project: Scenes.Project = Scenes.reload(ctx); private set
    private var fw = 1920
    private var fh = 1080
    private var away = false
    @Volatile private var released = false
    /** Called when the scene or a layer's switch changed (the chat panel shows them). */
    var onChanged: () -> Unit = {}
    /**
     * The whole screen is captured and the owner's screen shows the scene's own layers ([onMirror]):
     * those (and the phone's chat) are in the picture already, so they are not drawn a second time.
     */
    var screenInPicture = false
        set(v) { if (field != v) { field = v; push() } }
    /** [OwnerMirror] is on the screen (its layers are in a whole-screen picture). */
    var mirrorOn = false
        set(v) { if (field != v) { field = v; push() } }
    /** The chat panel's own feed is over the game (in a whole-screen picture when a chat layer is on). */
    var phoneChat = false
        set(v) { if (field != v) { field = v; push() } }
    /** The layers marked «on my screen too», for [OwnerMirror] (none while away from the game). */
    var onMirror: (List<OwnerMirror.Item>) -> Unit = {}
    /** Viewers' messages in Persian for the owner's own copy of the chat (the stream keeps the original). */
    private val ownerText = LinkedHashMap<String, String>()
    private var ownerChat: Pair<String, Bitmap?>? = null

    fun ownerText(id: String, text: String) {
        ownerText[id] = text
        while (ownerText.size > 200) ownerText.remove(ownerText.keys.first())
        if (data.chat.any { it.id == id }) push()
    }

    /** The chat as the owner reads it: translated lines in place of the originals. */
    private fun ownerPic(l: Scenes.Layer, b: Bitmap): Bitmap {
        if (l.kind != Scenes.Kind.CHAT || data.chat.none { it.id in ownerText }) return b
        val sig = l.id + l.p.toString() + data.chat.joinToString { it.id + (ownerText[it.id] ?: "") }
        ownerChat?.let { if (it.first == sig) return it.second ?: b }
        val lines = data.chat.map { c -> ownerText[c.id]?.let { LayerPainter.ChatLine(c.id, c.author, it, c.nameColor, c.accent) } ?: c }
        val pic = try { LayerPainter.chat(ctx, l, lines) } catch (_: Throwable) { null }
        ownerChat = sig to pic
        return pic ?: b
    }

    /** The scene on the stream now (the «away» scene while the game is off the screen). */
    val showing: Scenes.Scene get() = if (away) project.scene(project.away) ?: project.current else project.current
    /** A chat layer is on the stream now (the phone's chat would double it in a whole-screen capture). */
    val chatShown: Boolean get() = showing.layers.any { it.kind == Scenes.Kind.CHAT && it.visible }

    // ---- per layer: its picture, and the live sources
    private class Pic(val sig: String, val bmp: Bitmap?, val gen: Int)
    private val pics = HashMap<String, Pic>()
    private var gen = 1
    private val webs = HashMap<String, WebSource>()
    private val webPics = HashMap<String, Bitmap>()
    private val videos = HashMap<String, VideoSource>()
    private val gifs = HashMap<String, GifSource>()
    private val still = HashSet<String>()   // pictures that do not move (not opened as animations again)
    private var camera: CameraSource? = null
    private var cameraLayer: String? = null
    private val numIds = HashMap<String, Int>()
    private var nextNum = 10

    // ---- alerts: one at a time, the paid ones first
    private val queue = ArrayDeque<LayerPainter.Alert>()
    private var currentAlert: LayerPainter.Alert? = null
    private var shownAt = 0L
    private var holdMs = 0L
    private val reached = HashSet<String>()
    private val wasBelow = HashSet<String>()

    fun start(w: Int, h: Int) {
        fw = w; fh = h
        // every stream starts with the scene chosen for it (not the one switched to in the last stream)
        project.active = project.startScene.id
        data.startedAt = System.currentTimeMillis()
        apply()
        main.postDelayed(tick, 1000)
    }

    fun setSize(w: Int, h: Int) { if (w > 0 && h > 0 && (w != fw || h != fh)) { fw = w; fh = h; applyCover(); push() } }

    // ------------------------------------------------------------ the stream's numbers and events

    fun stats(viewers: Long, likes: Long, subs: Long) {
        data.viewers = viewers; data.likes = likes; data.subs = subs
        for ((k, v) in listOf("viewers" to viewers, "likes" to likes, "subs" to subs)) if (v >= 0) data.base.putIfAbsent(k, v)
        data.base.putIfAbsent("members", 0); data.base.putIfAbsent("supers", 0)
        checkGoals()
        push()
    }

    fun chat(line: LayerPainter.ChatLine) {
        data.chat = (data.chat + line).takeLast(30)
        push()
    }

    fun unchat(id: String) {
        if (data.chat.none { it.id == id }) return
        data.chat = data.chat.filter { it.id != id }
        push()
    }

    /** Old messages leave the stream's chat after [ms]. */
    fun expireChat(ms: Long, times: Map<String, Long>) {
        val now = System.currentTimeMillis()
        val keep = data.chat.filter { now - (times[it.id] ?: now) <= ms }
        if (keep.size != data.chat.size) { data.chat = keep; push() }
    }

    fun counted(kind: LayerPainter.AlertKind, n: Int = 1, name: String = "") {
        when (kind) {
            LayerPainter.AlertKind.MEMBER, LayerPainter.AlertKind.GIFT -> data.members += n
            LayerPainter.AlertKind.SUPER -> { data.supers += 1; data.lastSuper = name }
            LayerPainter.AlertKind.SUBSCRIBER -> data.lastSub = name
            else -> {}
        }
        checkGoals()
        push()
    }

    fun setManual(v: Long) { data.manual = v; checkGoals(); push() }

    fun alert(a: LayerPainter.Alert) {
        if (released) return
        if (a.kind == LayerPainter.AlertKind.SUBSCRIBER && queue.count { it.kind == LayerPainter.AlertKind.SUBSCRIBER } >= 3) {
            val subs = queue.filter { it.kind == LayerPainter.AlertKind.SUBSCRIBER }
            queue.removeAll { it.kind == LayerPainter.AlertKind.SUBSCRIBER }
            val names = (subs.map { it.name } + a.name).filter { it.isNotBlank() }
            queue.addLast(LayerPainter.Alert(LayerPainter.AlertKind.SUBSCRIBER, names.take(6).joinToString(ctx.getString(R.string.bot_and)) +
                if (names.size > 6) " +${names.size - 6}" else ""))
        } else if (queue.size < 30) {
            val paid = a.kind == LayerPainter.AlertKind.SUPER || a.kind == LayerPainter.AlertKind.GIVEAWAY || a.kind == LayerPainter.AlertKind.GOAL
            val i = if (paid) queue.indexOfFirst { it.kind != LayerPainter.AlertKind.SUPER && it.kind != LayerPainter.AlertKind.GIVEAWAY && it.kind != LayerPainter.AlertKind.GOAL } else -1
            if (i < 0) queue.addLast(a) else queue.add(i, a)
        }
        if (currentAlert == null) nextAlert()
    }

    /** A goal reached (after being below it) is celebrated once. */
    private fun checkGoals() {
        for (s in project.scenes) for (l in s.layers) if (l.kind == Scenes.Kind.GOAL) {
            val count = l.str("count", "subs")
            var v = data.value(count)
            if (v < 0) continue
            if (l.bool("since", false)) v -= data.base[count] ?: v
            val target = l.int("target", 1000).toLong()
            if (v < target) wasBelow += l.id
            else if (l.id in wasBelow && reached.add(l.id) && l.visible)
                alert(LayerPainter.Alert(LayerPainter.AlertKind.GOAL, LayerPainter.vars(l.str("title"), data), "${Num.grouped(v)} / ${Num.grouped(target)}"))
        }
    }

    private fun nextAlert() {
        val a = queue.removeFirstOrNull()
        currentAlert = a
        if (a == null) { push(); return }
        val alertsLayer = showing.layers.firstOrNull { it.kind == Scenes.Kind.ALERTS && it.visible }
        val dur = (alertsLayer?.int("dur", 6) ?: 6).coerceIn(2, 30) * 1000L
        holdMs = if (a.kind == LayerPainter.AlertKind.SUPER && !a.message.isNullOrBlank()) dur + 3000 else dur
        shownAt = System.currentTimeMillis()
        main.removeCallbacks(anim)
        main.post(anim)
    }

    private val anim = object : Runnable {
        override fun run() {
            if (released || currentAlert == null) return
            val t = System.currentTimeMillis() - shownAt
            if (t > IN + holdMs + OUT) { nextAlert(); return }
            push()
            val still = t in IN..(IN + holdMs)
            main.postDelayed(this, if (still) (IN + holdMs - t + 1).coerceAtLeast(1) else 33)
        }
    }

    private fun alertMotion(): Pair<Float, Float> {
        val t = System.currentTimeMillis() - shownAt
        val k = when { t < IN -> t / IN.toFloat(); t < IN + holdMs -> 1f; else -> (1f - (t - IN - holdMs) / OUT.toFloat()).coerceAtLeast(0f) }
        val e = 1f - (1f - k) * (1f - k)
        return e to (1f - e) * -28f
    }

    // ------------------------------------------------------------ scenes

    fun select(sceneId: String) {
        if (project.scene(sceneId) == null) return
        project.active = sceneId
        Scenes.save(ctx, project)
        apply()
        onChanged()
    }

    /** The game left the screen (true) or came back: the «away» scene, then the scene before. */
    fun setAway(on: Boolean) {
        if (away == on) return
        away = on
        apply()
        onChanged()
    }

    val isAway get() = away

    fun setLayerVisible(layerId: String, on: Boolean) {
        val l = showing.layers.firstOrNull { it.id == layerId } ?: return
        l.visible = on
        Scenes.save(ctx, project)
        apply()
        onChanged()
    }

    /** The editor saved while live: everything as it is now on the phone. */
    fun reload() {
        val active = project.active
        project = Scenes.reload(ctx)
        if (project.scene(active) != null) project.active = active
        pics.clear()
        apply()
        onChanged()
    }

    /** Start / stop the live sources the scene needs, set its background, draw. */
    private fun apply() {
        if (released) return
        val s = showing
        val needed = s.layers.filter { it.visible }.associateBy { it.id }
        // web pages
        for (id in webs.keys.filter { needed[it]?.kind != Scenes.Kind.WEB }) { webs.remove(id)?.release(); webPics.remove(id) }
        for (l in needed.values.filter { it.kind == Scenes.Kind.WEB }) {
            val w = webs.getOrPut(l.id) { WebSource(ctx, WebSource.OffscreenWindow(ctx)) { b -> webPics[l.id] = b; pics.remove(l.id); push() } }
            w.configure(l)
        }
        // videos
        for (id in videos.keys.filter { needed[it]?.kind != Scenes.Kind.VIDEO || needed[it]?.str("file") != videos[it]?.file }) videos.remove(id)?.release()
        for (l in needed.values.filter { it.kind == Scenes.Kind.VIDEO && it.str("file").isNotBlank() }) {
            if (l.id !in videos) VideoSource.open(filter, l.str("file"), l.bool("loop", true)) { push() }?.let { videos[l.id] = it }
        }
        // GIFs and other animated pictures
        for (id in gifs.keys.filter { needed[it]?.kind != Scenes.Kind.IMAGE || needed[it]?.str("file") != gifs[it]?.file }) gifs.remove(id)?.release()
        for (l in needed.values.filter { it.kind == Scenes.Kind.IMAGE }) {
            val f = l.str("file")
            if (l.id !in gifs && f !in still) GifSource.open(f) { push() }?.let { gifs[l.id] = it } ?: still.add(f)
        }
        // the camera (one at a time)
        val cam = needed.values.firstOrNull { it.kind == Scenes.Kind.CAMERA }
        if (cam == null || cam.id != cameraLayer || camera?.front != cam.bool("front", true)) {
            camera?.release(); camera = null; cameraLayer = null
            if (cam != null) { camera = CameraSource.open(ctx, filter, cam.bool("front", true)) { main.post { if (!released) push() } }; cameraLayer = cam.id }
        }
        applyCover()
        push()
    }

    private var coverKey = ""

    private fun applyCover() {
        val s = showing
        // away: the screen is always hidden (whatever the owner opened instead of the game stays private)
        val covered = !s.game || away
        val key = if (!covered) "" else "${s.id}:${s.bg}:${s.bgImage}:$fw:$fh"
        if (key == coverKey) return
        coverKey = key
        if (!covered) { coverSink(null); return }
        val b = Bitmap.createBitmap(fw, fh, Bitmap.Config.ARGB_8888)
        val c = Canvas(b)
        c.drawColor(s.bg)
        LayerPainter.image(ctx, s.bgImage)?.let { img ->
            val k = maxOf(fw / img.width.toFloat(), fh / img.height.toFloat())
            val w = img.width * k; val h = img.height * k
            c.drawBitmap(img, null, RectF((fw - w) / 2f, (fh - h) / 2f, (fw + w) / 2f, (fh + h) / 2f), Paint(Paint.FILTER_BITMAP_FLAG))
        }
        coverSink(b)
    }

    // ------------------------------------------------------------ drawing

    private val tick = object : Runnable {
        override fun run() {
            if (released) return
            camera?.followScreen(ctx)
            push()
            main.postDelayed(this, 1000)
        }
    }

    private fun numId(layerId: String) = numIds.getOrPut(layerId) { nextNum++ }

    /** Where a layer lies on the stream now: centre and size as fractions of the picture (the in-game editor). */
    class Box(val id: String, val name: String, val kind: Scenes.Kind, val x: Float, val y: Float, val w: Float, val h: Float, val rot: Float, val locked: Boolean)
    @Volatile override var boxes: List<Box> = emptyList(); private set

    override fun layerOf(id: String) = showing.layers.firstOrNull { it.id == id }

    /** 8.4: moved / resized over the game ([InPlaceEditor]): on the stream at once, saved by [commitEdit]. */
    override fun editLayer(id: String, x: Float, y: Float, scale: Float) {
        val l = layerOf(id) ?: return
        l.x = x.coerceIn(0f, 1f); l.y = y.coerceIn(0f, 1f); l.scale = scale.coerceIn(0.05f, 8f)
        push()
    }

    override fun commitEdit() { Scenes.save(ctx, project); onChanged() }

    /** The scene's layers, back to front, as the GPU stage draws them. */
    override fun push() {
        if (released) return
        val out = ArrayList<LookFilter.Layer>()
        val mirror = ArrayList<OwnerMirror.Item>()
        val placed = ArrayList<Box>()
        // the scene's own background replaces the screen (or «برمی‌گردم» does): the screen is not in the picture then
        val covered = away || !showing.game
        for (l in showing.layers) {
            if (!l.visible) continue
            val who = Scenes.audience(l)
            val mine = who != 1          // on the owner's screen
            val onlyMine = who == 2      // on the owner's screen and never on the stream
            val inPicture = onlyMine || (screenInPicture && !covered && ((mine && mirrorOn) || (l.kind == Scenes.Kind.CHAT && phoneChat)))
            var alpha = l.alpha
            var dy = 0f
            var natW: Float
            var natH: Float
            var bmp: Bitmap? = null
            var g = 0
            var ext = 0
            var corner = 0f
            when (l.kind) {
                Scenes.Kind.VIDEO -> {
                    val v = videos[l.id] ?: continue
                    if (v.ext == 0 || v.w == 0) continue
                    ext = v.ext; natW = v.w.toFloat(); natH = v.h.toFloat(); corner = l.num("radius", 0f)
                }
                Scenes.Kind.CAMERA -> {
                    val c = camera?.takeIf { cameraLayer == l.id } ?: continue
                    if (c.ext == 0) continue
                    ext = c.ext; natW = c.outW.toFloat(); natH = c.outH.toFloat()
                    corner = when (l.int("mask", 1)) { 2 -> 99999f; 1 -> 36f; else -> 0f }
                }
                else -> {
                    val pic = picture(l) ?: continue
                    bmp = pic.bmp ?: continue
                    g = pic.gen
                    natW = bmp.width.toFloat(); natH = bmp.height.toFloat()
                    if (l.kind == Scenes.Kind.IMAGE) corner = l.num("radius", 0f)
                    if (l.kind == Scenes.Kind.ALERTS) { val (a, d) = alertMotion(); alpha *= a; dy = d }
                }
            }
            // natural size in pixels of a frame 1080 high, anything bigger fitted inside it (as in the editor);
            // on the stream one such pixel is [unit] real ones, the same across and down (nothing stretched)
            val unit = minOf(fw, fh) / 1080f
            Scenes.fit(natW, natH, fw / unit).let { natW = it.first; natH = it.second }
            val c = Scenes.cropFor(l, natW, natH)
            val wF = natW * (c[2] - c[0]) * l.scale * unit / fw
            val hF = natH * (c[3] - c[1]) * l.scale * unit / fh
            val x = l.x - wF / 2f
            val y = l.y - hF / 2f + dy * unit / fh
            placed += Box(l.id, l.name, l.kind, l.x, l.y + dy * unit / fh, wF, hF, l.rot, l.locked)
            // on the phone only over the game: a scene of its own (the game hidden) is told in one line instead
            if (mine && bmp != null && !away && showing.game)
                mirror += OwnerMirror.Item(l.kind, ownerPic(l, bmp), l.x, l.y, dy, l.scale, l.rot, c.copyOf(), alpha, corner, Scenes.hasNumbers(l))
            if (inPicture) continue
            out += LookFilter.Layer(numId(l.id), bmp, g, x, y, wF, hF, alpha, l.rot, c.copyOf(), ext, corner * l.scale,
                l.kind == Scenes.Kind.CAMERA && l.bool("mirror", true))
        }
        boxes = placed
        onMirror(mirror)
        filter.setLayers(out)
    }

    /** The layer's picture, drawn again only when what it shows changed. */
    private fun picture(l: Scenes.Layer): Pic? {
        if (l.kind == Scenes.Kind.WEB) {
            val b = webPics[l.id] ?: return null
            val old = pics[l.id]
            if (old?.bmp === b) return old
            return Pic("web", b, ++gen).also { pics[l.id] = it }
        }
        if (l.kind == Scenes.Kind.IMAGE) gifs[l.id]?.let { gs ->
            val b = gs.frame ?: return null
            val old = pics[l.id]
            if (old?.bmp === b && old.sig == "gif${gs.count}") return old
            return Pic("gif${gs.count}", b, ++gen).also { pics[l.id] = it }
        }
        val alert = if (l.kind == Scenes.Kind.ALERTS) currentAlert else null
        if (l.kind == Scenes.Kind.ALERTS && alert == null) return null
        val sig = sig(l, alert)
        pics[l.id]?.let { if (it.sig == sig) return it }
        val b = LayerPainter.paint(ctx, l, data, alert, sample = false)
        return Pic(sig, b, ++gen).also { pics[l.id] = it }
    }

    private fun sig(l: Scenes.Layer, alert: LayerPainter.Alert?): String = l.p.toString() + "|" + when (l.kind) {
        Scenes.Kind.TEXT -> LayerPainter.vars(l.str("text"), data)
        Scenes.Kind.CHAT -> data.chat.joinToString { it.id }
        Scenes.Kind.GOAL -> "${data.value(l.str("count", "subs"))}:${data.base[l.str("count", "subs")]}:${LayerPainter.vars(l.str("title"), data)}"
        Scenes.Kind.ALERTS -> System.identityHashCode(alert).toString()
        else -> ""
    }

    fun release() {
        released = true
        main.removeCallbacksAndMessages(null)
        for (w in webs.values) w.release()
        webs.clear(); webPics.clear()
        for (v in videos.values) v.release()
        videos.clear()
        for (g in gifs.values) g.release()
        gifs.clear()
        camera?.release(); camera = null
        try { filter.setLayers(emptyList()) } catch (_: Throwable) {}
        try { onMirror(emptyList()) } catch (_: Throwable) {}
        coverSink(null)
    }

    // ------------------------------------------------------------ live sources

    /** A video file playing (muted, looping) into a GPU texture. */
    class VideoSource private constructor(val file: String, private val filter: LookFilter, private val mp: MediaPlayer, val ext: Int) {
        @Volatile var w = 0; private set
        @Volatile var h = 0; private set

        fun release() {
            try { mp.stop() } catch (_: Throwable) {}
            try { mp.release() } catch (_: Throwable) {}
            filter.releaseExternal(ext)
        }

        companion object {
            fun open(filter: LookFilter, file: String, loop: Boolean, onSize: () -> Unit): VideoSource? {
                if (!File(file).isFile) return null
                val (ext, surface) = filter.createExternal(0, 0) ?: return null
                val mp = MediaPlayer()
                val v = VideoSource(file, filter, mp, ext)
                try {
                    mp.setSurface(surface)
                    mp.setDataSource(file)
                    mp.isLooping = loop
                    mp.setVolume(0f, 0f)
                    mp.setOnVideoSizeChangedListener { _, w, h -> v.w = w; v.h = h; onSize() }
                    mp.setOnPreparedListener { it.start() }
                    mp.prepareAsync()
                } catch (_: Throwable) { v.release(); return null }
                return v
            }
        }
    }

    /** An animated picture (GIF / animated WebP) drawn into pictures ~15 times a second; null for still ones. */
    class GifSource private constructor(val file: String, private val d: AnimatedImageDrawable) {
        private val main = Handler(Looper.getMainLooper())
        private val ring = arrayOfNulls<Bitmap>(3)
        private var next = 0
        @Volatile var frame: Bitmap? = null; private set
        var count = 0; private set
        private var onFrame: () -> Unit = {}
        private val step = object : Runnable {
            override fun run() {
                val w = d.intrinsicWidth.coerceIn(1, 1920); val h = d.intrinsicHeight.coerceIn(1, 1080)
                val b = ring[next] ?: Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { ring[next] = it }
                next = (next + 1) % ring.size
                b.eraseColor(0)
                d.setBounds(0, 0, w, h)
                d.draw(Canvas(b))
                frame = b; count++
                onFrame()
                main.postDelayed(this, 66)
            }
        }

        fun release() { main.removeCallbacksAndMessages(null); try { d.stop() } catch (_: Throwable) {} }

        companion object {
            fun open(file: String, onFrame: () -> Unit): GifSource? {
                if (file.isBlank() || !File(file).isFile || !canMove(File(file))) return null
                val dr = try { ImageDecoder.decodeDrawable(ImageDecoder.createSource(File(file))) } catch (_: Throwable) { null }
                val a = dr as? AnimatedImageDrawable ?: return null
                a.repeatCount = AnimatedImageDrawable.REPEAT_INFINITE
                a.start()
                return GifSource(file, a).also { it.onFrame = onFrame; it.main.post(it.step) }
            }

            /** GIF or WebP (the formats that animate): a photo is never decoded whole just to find out. */
            private fun canMove(f: File): Boolean = try {
                val h = ByteArray(12)
                val n = f.inputStream().use { it.read(h) }
                n >= 12 && ((h[0] == 'G'.code.toByte() && h[1] == 'I'.code.toByte() && h[2] == 'F'.code.toByte()) ||
                    (String(h, 0, 4, Charsets.US_ASCII) == "RIFF" && String(h, 8, 4, Charsets.US_ASCII) == "WEBP"))
            } catch (_: Exception) { false }
        }
    }

    /** The phone's camera into a GPU texture, turned upright for a landscape stream. */
    class CameraSource private constructor(private val filter: LookFilter, val front: Boolean) {
        private val thread = HandlerThread("rawrec-camera").apply { start() }
        private val handler = Handler(thread.looper)
        private var device: CameraDevice? = null
        private var session: CameraCaptureSession? = null
        @Volatile private var closed = false
        @Volatile var ext = 0; private set
        @Volatile var outW = 0; private set
        @Volatile var outH = 0; private set
        private var sensor = 0
        private var sizeW = 0
        private var sizeH = 0
        private var turn = -1

        /** Upright for the screen as it is turned now (the stream is landscape, either way round). */
        fun followScreen(ctx: Context) {
            @Suppress("DEPRECATION")
            val disp = (ctx.getSystemService(WindowManager::class.java)?.defaultDisplay?.rotation ?: Surface.ROTATION_90) * 90
            val t = if (front) (sensor + disp) % 360 else (sensor - disp + 360) % 360
            if (t == turn || ext == 0) return
            turn = t
            filter.setExternalRotation(ext, t.toFloat())
            if (t % 180 != 0) { outW = sizeH; outH = sizeW } else { outW = sizeW; outH = sizeH }
        }

        /** Closed on the camera's own thread, after an open still on its way (the camera is never left on). */
        fun release() {
            closed = true
            val e = ext
            ext = 0
            handler.post {
                try { session?.close() } catch (_: Throwable) {}
                try { device?.close() } catch (_: Throwable) {}
                session = null; device = null
                if (e != 0) filter.releaseExternal(e)
                thread.quitSafely()
            }
        }

        companion object {
            @SuppressLint("MissingPermission")
            fun open(ctx: Context, filter: LookFilter, front: Boolean, onReady: () -> Unit): CameraSource? {
                if (ctx.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return null
                val cm = ctx.getSystemService(CameraManager::class.java) ?: return null
                val facing = if (front) CameraCharacteristics.LENS_FACING_FRONT else CameraCharacteristics.LENS_FACING_BACK
                val id = cm.cameraIdList.firstOrNull { cm.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) == facing }
                    ?: cm.cameraIdList.firstOrNull() ?: return null
                val ch = cm.getCameraCharacteristics(id)
                val sizes = ch.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)?.getOutputSizes(SurfaceTexture::class.java) ?: return null
                val size = sizes.filter { it.width <= 1280 && it.height <= 960 }.maxByOrNull { it.width * it.height } ?: sizes.minByOrNull { it.width * it.height } ?: return null
                val src = CameraSource(filter, front)
                val (ext, surface) = filter.createExternal(size.width, size.height) ?: run { src.thread.quitSafely(); return null }
                src.ext = ext
                src.sensor = ch.get(CameraCharacteristics.SENSOR_ORIENTATION) ?: 0
                src.sizeW = size.width; src.sizeH = size.height
                src.followScreen(ctx)
                try {
                    cm.openCamera(id, object : CameraDevice.StateCallback() {
                        override fun onOpened(d: CameraDevice) {
                            if (src.closed) { try { d.close() } catch (_: Throwable) {}; return }
                            src.device = d
                            try {
                                @Suppress("DEPRECATION")
                                d.createCaptureSession(listOf(surface), object : CameraCaptureSession.StateCallback() {
                                    override fun onConfigured(s: CameraCaptureSession) {
                                        if (src.closed) { try { s.close() } catch (_: Throwable) {}; return }
                                        src.session = s
                                        try {
                                            val req = d.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply { addTarget(surface) }.build()
                                            s.setRepeatingRequest(req, null, src.handler)
                                            onReady()
                                        } catch (_: Throwable) {}
                                    }
                                    override fun onConfigureFailed(s: CameraCaptureSession) {}
                                }, src.handler)
                            } catch (_: Throwable) {}
                        }
                        override fun onDisconnected(d: CameraDevice) { try { d.close() } catch (_: Throwable) {} }
                        override fun onError(d: CameraDevice, e: Int) { try { d.close() } catch (_: Throwable) {} }
                    }, src.handler)
                } catch (_: Throwable) { src.release(); return null }
                return src
            }
        }
    }

    companion object {
        private const val IN = 350L
        private const val OUT = 350L
    }
}
