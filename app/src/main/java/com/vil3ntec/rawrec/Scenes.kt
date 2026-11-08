package com.vil3ntec.rawrec

import android.content.Context
import android.graphics.Color
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * Scenes and layers, as in the professional streaming apps: a scene is what viewers see at one
 * moment («بازی», «به‌زودی شروع می‌کنیم», «برمی‌گردم», «پایان» …), made of layers the owner adds
 * freely — text (with live numbers), pictures and GIFs, videos, web pages (cropped to any part),
 * the chat, thank-you alerts, a goal bar, shapes and the camera — each placed, sized, turned and
 * faded by hand. Saved as one JSON file; media the owner picks are copied next to it so they stay.
 *
 * Geometry is in the stream's frame: (x, y) is the layer's centre as fractions of the frame,
 * [Layer.scale] multiplies the layer's natural size (in pixels of a 1920×1080 frame), [Layer.rot]
 * turns it (degrees), [Layer.crop] keeps a part of the source (left, top, right, bottom fractions).
 */
object Scenes {

    enum class Kind { TEXT, IMAGE, VIDEO, WEB, CHAT, ALERTS, GOAL, SHAPE, CAMERA }

    class Layer(
        val id: String,
        var kind: Kind,
        var name: String,
        var x: Float = 0.5f,
        var y: Float = 0.5f,
        var scale: Float = 1f,
        var rot: Float = 0f,
        var alpha: Float = 1f,
        var visible: Boolean = true,
        var locked: Boolean = false,
        var crop: FloatArray = floatArrayOf(0f, 0f, 1f, 1f),
        /** What the kind needs (text, colours, file, url …): see [defaults]. */
        val p: JSONObject = JSONObject(),
    ) {
        fun str(k: String, d: String = "") = p.optString(k, d)
        fun int(k: String, d: Int) = if (p.has(k)) p.optInt(k, d) else d
        fun num(k: String, d: Float) = if (p.has(k)) p.optDouble(k, d.toDouble()).toFloat() else d
        fun bool(k: String, d: Boolean) = if (p.has(k)) p.optBoolean(k, d) else d
        fun copy(newId: Boolean = true): Layer = layerFromJson(toJson()).let {
            if (!newId) it else Layer(newId(), it.kind, it.name, it.x, it.y, it.scale, it.rot, it.alpha, it.visible, false, it.crop.copyOf(), it.p)
        }

        fun toJson(): JSONObject = JSONObject().put("id", id).put("kind", kind.name).put("name", name)
            .put("x", x.toDouble()).put("y", y.toDouble()).put("scale", scale.toDouble()).put("rot", rot.toDouble())
            .put("alpha", alpha.toDouble()).put("visible", visible).put("locked", locked)
            .put("crop", JSONArray().apply { crop.forEach { put(it.toDouble()) } }).put("p", JSONObject(p.toString()))
    }

    class Scene(
        val id: String,
        var name: String,
        /** True: the game is the picture; false: [bg] (a colour or the owner's picture) instead. */
        var game: Boolean = true,
        var bg: Int = Color.rgb(16, 18, 26),
        var bgImage: String = "",
        val layers: MutableList<Layer> = ArrayList(),
    ) {
        fun toJson(): JSONObject = JSONObject().put("id", id).put("name", name).put("game", game).put("bg", bg).put("bgImage", bgImage)
            .put("layers", JSONArray().apply { layers.forEach { put(it.toJson()) } })
    }

    class Project(
        val scenes: MutableList<Scene>,
        /** The scene on the stream now (switched from the chat panel while live). */
        var active: String,
        /** The scene shown when the game leaves the screen (and for the «برمی‌گردم» button). */
        var away: String,
        /** The scene every stream starts with (chosen in the editor; looking at another scene there does not change it). */
        var start: String = active,
    ) {
        fun scene(id: String) = scenes.firstOrNull { it.id == id }
        val current: Scene get() = scene(active) ?: scenes.first()
        val startScene: Scene get() = scene(start) ?: scenes.firstOrNull { it.game } ?: scenes.first()

        fun toJson(): JSONObject = JSONObject().put("v", 1).put("active", active).put("away", away).put("start", start)
            .put("scenes", JSONArray().apply { scenes.forEach { put(it.toJson()) } })
    }

    fun newId() = UUID.randomUUID().toString().substring(0, 8)

    // ------------------------------------------------------------ load / save

    private fun file(ctx: Context) = File(ctx.filesDir, "scenes.json")

    /** Where the owner's pictures and videos for the layers are kept. */
    fun mediaDir(ctx: Context) = File(ctx.filesDir, "scene_media").apply { mkdirs() }

    /**
     * The stream's shape: this phone's screen held sideways (the stream is the screen, so a 20:9
     * phone streams 20:9). Sizes everywhere are in pixels of a frame 1080 high (the short side).
     */
    fun aspect(ctx: Context): Float {
        val dm = android.util.DisplayMetrics()
        try { @Suppress("DEPRECATION") ctx.getSystemService(android.view.WindowManager::class.java)?.defaultDisplay?.getRealMetrics(dm) } catch (_: Exception) {}
        val lo = minOf(dm.widthPixels, dm.heightPixels); val hi = maxOf(dm.widthPixels, dm.heightPixels)
        val a = if (lo > 0) hi.toFloat() / lo else 0f
        return if (a > 1f) a.coerceIn(1.25f, 2.6f) else 16f / 9f
    }

    /** [w]×[h] (pixels of a frame 1080 high) made to fit inside a frame [designW]×1080. */
    fun fit(w: Float, h: Float, designW: Float): Pair<Float, Float> =
        if (w > designW || h > 1080f) { val k = minOf(designW / w, 1080f / h); (w * k) to (h * k) } else w to h

    /** Shown on the owner's own screen too (the chat, goal, counters and alerts are, unless turned off). */
    fun mine(l: Layer): Boolean = l.kind != Kind.VIDEO && l.kind != Kind.CAMERA &&
        l.bool("mine", l.kind == Kind.CHAT || l.kind == Kind.GOAL || l.kind == Kind.TEXT || l.kind == Kind.ALERTS)

    /** A text with live numbers in it. */
    fun hasNumbers(l: Layer): Boolean = l.kind == Kind.TEXT && listOf("{viewers}", "{subs}", "{likes}", "{members}").any { l.str("text").contains(it) }

    /** The part of a [w]×[h] source that is shown: the owner's crop, made square for a round camera. */
    fun cropFor(l: Layer, w: Float, h: Float): FloatArray {
        val c = l.crop
        if (l.kind != Kind.CAMERA || l.int("mask", 1) != 2 || w <= 0f || h <= 0f) return c
        val pw = w * (c[2] - c[0]); val ph = h * (c[3] - c[1])
        return if (pw > ph) { val d = (pw - ph) / 2f / w; floatArrayOf(c[0] + d, c[1], c[2] - d, c[3]) }
        else { val d = (ph - pw) / 2f / h; floatArrayOf(c[0], c[1] + d, c[2], c[3] - d) }
    }

    /** Pictures and videos no layer or scene uses any more (deleted layers, replaced files). */
    fun cleanMedia(ctx: Context, p: Project) {
        val used = HashSet<String>()
        for (s in p.scenes) {
            used += s.bgImage
            for (l in s.layers) { used += l.str("file"); used += l.str("image") }
        }
        val old = System.currentTimeMillis() - 60_000
        mediaDir(ctx).listFiles()?.forEach { f -> if (f.path !in used && f.lastModified() < old) f.delete() }
    }

    private var cached: Project? = null
    @Volatile var version = 0; private set

    @Synchronized
    fun load(ctx: Context): Project {
        cached?.let { return it }
        val p = try { file(ctx).takeIf { it.isFile }?.readText()?.let { projectFromJson(JSONObject(it)) } } catch (_: Exception) { null }
            ?: defaults(ctx).also { save(ctx, it) }
        cached = p
        return p
    }

    @Synchronized
    fun save(ctx: Context, p: Project) {
        cached = p
        version++
        try {
            val f = file(ctx)
            val tmp = File(f.path + ".tmp")
            tmp.writeText(p.toJson().toString())
            tmp.renameTo(f)
        } catch (_: Exception) {}
    }

    /** Forget the copy in memory (another process, or tests). */
    @Synchronized
    fun reload(ctx: Context): Project { cached = null; return load(ctx) }

    fun projectFromJson(o: JSONObject): Project {
        val scenes = ArrayList<Scene>()
        val a = o.optJSONArray("scenes") ?: JSONArray()
        for (i in 0 until a.length()) {
            val s = a.getJSONObject(i)
            val layers = ArrayList<Layer>()
            val la = s.optJSONArray("layers") ?: JSONArray()
            for (j in 0 until la.length()) try { layers += layerFromJson(la.getJSONObject(j)) } catch (_: Exception) {}
            scenes += Scene(s.getString("id"), s.optString("name"), s.optBoolean("game", true), s.optInt("bg", Color.rgb(16, 18, 26)),
                s.optString("bgImage"), layers)
        }
        if (scenes.isEmpty()) scenes += Scene(newId(), "Scene")
        val active = o.optString("active").takeIf { id -> scenes.any { it.id == id } } ?: scenes.first().id
        val away = o.optString("away").takeIf { id -> scenes.any { it.id == id } } ?: scenes.firstOrNull { !it.game }?.id ?: active
        // (before 3.6 the scene last open in the editor started the stream: the game scene does now)
        val start = o.optString("start").takeIf { id -> scenes.any { it.id == id } } ?: scenes.firstOrNull { it.game }?.id ?: active
        return Project(scenes, active, away, start)
    }

    fun layerFromJson(o: JSONObject): Layer {
        val c = o.optJSONArray("crop")
        val crop = if (c != null && c.length() == 4) FloatArray(4) { c.optDouble(it).toFloat() } else floatArrayOf(0f, 0f, 1f, 1f)
        return Layer(o.getString("id"), Kind.valueOf(o.getString("kind")), o.optString("name"),
            o.optDouble("x", 0.5).toFloat(), o.optDouble("y", 0.5).toFloat(), o.optDouble("scale", 1.0).toFloat(),
            o.optDouble("rot", 0.0).toFloat(), o.optDouble("alpha", 1.0).toFloat(), o.optBoolean("visible", true),
            o.optBoolean("locked", false), crop, o.optJSONObject("p") ?: JSONObject())
    }

    // ------------------------------------------------------------ new layers

    /** A new layer of [kind] with sensible starting values, in the middle of the frame. */
    fun newLayer(ctx: Context, kind: Kind): Layer {
        val l = Layer(newId(), kind, ctx.getString(kindName(kind)), p = defaults(ctx, kind))
        when (kind) {
            Kind.CHAT -> { l.x = 0.18f; l.y = 0.62f }
            Kind.ALERTS -> { l.x = 0.5f; l.y = 0.12f; l.scale = 0.8f }
            Kind.GOAL -> { l.x = 0.18f; l.y = 0.92f }
            Kind.CAMERA -> { l.x = 0.86f; l.y = 0.78f; l.scale = 0.5f }
            Kind.WEB -> { l.scale = 0.5f }
            else -> {}
        }
        return l
    }

    fun defaults(ctx: Context, kind: Kind): JSONObject = when (kind) {
        Kind.TEXT -> JSONObject().put("text", ctx.getString(R.string.sc_text_default)).put("size", 56).put("color", Color.WHITE)
            .put("bg", Color.argb(0, 0, 0, 0)).put("bold", true).put("align", 1).put("shadow", 0.8).put("font", 0).put("pad", 16).put("radius", 18)
        Kind.IMAGE -> JSONObject().put("file", "").put("radius", 0)
        Kind.VIDEO -> JSONObject().put("file", "").put("loop", true).put("radius", 0)
        Kind.WEB -> JSONObject().put("url", "https://").put("vw", 1280).put("vh", 720).put("fps", 4).put("transparent", true).put("css", "").put("zoom", 100)
        Kind.CHAT -> JSONObject().put("style", 1).put("size", 29).put("lines", 6).put("width", 600).put("color", Color.WHITE).put("bgAlpha", 200)
        Kind.ALERTS -> JSONObject().put("dur", 6).put("color", 0).put("image", "")
            .put("t_sub", ctx.getString(R.string.sc_t_sub)).put("t_member", ctx.getString(R.string.sc_t_member))
            .put("t_super", ctx.getString(R.string.sc_t_super)).put("t_gift", ctx.getString(R.string.sc_t_gift))
            .put("t_cheer", ctx.getString(R.string.sc_t_cheer)).put("t_raid", ctx.getString(R.string.sc_t_raid))
            .put("t_give", ctx.getString(R.string.sc_t_give)).put("t_goal", ctx.getString(R.string.sc_t_goal))
        Kind.GOAL -> JSONObject().put("title", ctx.getString(R.string.sc_goal_default)).put("count", "subs").put("start", 0).put("target", 1000)
            .put("c1", Color.rgb(255, 59, 71)).put("c2", Color.rgb(255, 176, 32)).put("color", Color.WHITE).put("bgAlpha", 200)
            .put("width", 600).put("pct", true)
        Kind.SHAPE -> JSONObject().put("w", 600).put("h", 120).put("color", Color.argb(200, 14, 15, 20)).put("radius", 24)
            .put("border", Color.argb(80, 255, 255, 255)).put("borderW", 2)
        Kind.CAMERA -> JSONObject().put("front", true).put("mask", 1).put("mirror", true).put("border", Color.WHITE).put("borderW", 0)
    }

    fun kindName(k: Kind) = when (k) {
        Kind.TEXT -> R.string.sc_k_text
        Kind.IMAGE -> R.string.sc_k_image
        Kind.VIDEO -> R.string.sc_k_video
        Kind.WEB -> R.string.sc_k_web
        Kind.CHAT -> R.string.sc_k_chat
        Kind.ALERTS -> R.string.sc_k_alerts
        Kind.GOAL -> R.string.sc_k_goal
        Kind.SHAPE -> R.string.sc_k_shape
        Kind.CAMERA -> R.string.sc_k_camera
    }

    fun kindIcon(k: Kind) = when (k) {
        Kind.TEXT -> R.drawable.ic_tag
        Kind.IMAGE -> R.drawable.ic_file
        Kind.VIDEO -> R.drawable.ic_movie
        Kind.WEB -> R.drawable.ic_link
        Kind.CHAT -> R.drawable.ic_chat
        Kind.ALERTS -> R.drawable.ic_bell
        Kind.GOAL -> R.drawable.ic_flag
        Kind.SHAPE -> R.drawable.ic_layers
        Kind.CAMERA -> R.drawable.ic_camera
    }

    // ------------------------------------------------------------ first run

    /**
     * The starting scenes. «بازی» carries over what the owner set before 3.4 (where the chat, goal,
     * counters and alerts were and whether they were shown); the others are ready to change.
     */
    fun defaults(ctx: Context): Project {
        fun text(name: Int, t: String, x: Float, y: Float, size: Int, bg: Int = 0, bold: Boolean = true) =
            newLayer(ctx, Kind.TEXT).apply {
                this.name = ctx.getString(name); this.x = x; this.y = y
                p.put("text", t).put("size", size).put("bg", bg).put("bold", bold)
            }
        val pill = Color.argb(200, 14, 15, 20)
        val old = { key: String -> OverlayLayout.place(ctx, key) }
        val game = Scene(newId(), ctx.getString(R.string.sc_scene_game), game = true)
        game.layers += newLayer(ctx, Kind.CHAT).apply { old(OverlayLayout.CHAT).let { x = it.x; y = it.y; scale = it.scale }; visible = LiveExtras.chatOnStream(ctx); p.put("style", LiveExtras.chatStyle(ctx)) }
        game.layers += newLayer(ctx, Kind.GOAL).apply {
            old(OverlayLayout.GOAL).let { x = it.x; y = it.y; scale = it.scale }; visible = LiveExtras.goal(ctx)
            p.put("count", when (LiveExtras.goalType(ctx)) { LiveExtras.GOAL_LIKES -> "likes"; LiveExtras.GOAL_MEMBERS -> "members"; LiveExtras.GOAL_MANUAL -> "manual"; else -> "subs" })
            p.put("target", LiveExtras.goalTarget(ctx))
            LiveExtras.goalTitle(ctx).takeIf { it.isNotBlank() }?.let { p.put("title", it) }
        }
        game.layers += text(R.string.lay_subs, ctx.getString(R.string.sc_subs_text), 0f, 0f, 30, pill).apply {
            old(OverlayLayout.SUBS).let { x = it.x; y = it.y; scale = it.scale }; visible = LiveExtras.subsBadge(ctx)
        }
        game.layers += text(R.string.lay_viewers, ctx.getString(R.string.sc_viewers_text), 0f, 0f, 30, pill).apply {
            old(OverlayLayout.VIEWERS).let { x = it.x; y = it.y; scale = it.scale }; visible = LiveExtras.viewersBadge(ctx)
        }
        // (0.8: clear of the two counters at the top)
        game.layers += newLayer(ctx, Kind.ALERTS).apply { old(OverlayLayout.ALERT).let { x = it.x; y = it.y; scale = it.scale * 0.8f }; visible = LiveExtras.alerts(ctx) }

        val soon = Scene(newId(), ctx.getString(R.string.sc_scene_soon), game = false, bg = Color.rgb(20, 22, 34))
        soon.layers += text(R.string.sc_k_text, ctx.getString(R.string.sc_soon_title), 0.5f, 0.42f, 110)
        soon.layers += text(R.string.sc_k_text, "{time}", 0.5f, 0.58f, 44, bold = false)
        soon.layers += newLayer(ctx, Kind.CHAT).apply { x = 0.17f; y = 0.7f }

        val away = Scene(newId(), ctx.getString(R.string.sc_scene_away), game = false, bg = Color.rgb(34, 18, 26))
        away.layers += text(R.string.sc_k_text, ctx.getString(R.string.live_brb), 0.5f, 0.45f, 110)
        away.layers += text(R.string.sc_k_text, ctx.getString(R.string.live_brb_sub), 0.5f, 0.6f, 44, bold = false)
        away.layers += newLayer(ctx, Kind.CHAT).apply { x = 0.17f; y = 0.7f }
        away.layers += newLayer(ctx, Kind.ALERTS)

        val end = Scene(newId(), ctx.getString(R.string.sc_scene_end), game = false, bg = Color.rgb(16, 18, 26))
        end.layers += text(R.string.sc_k_text, ctx.getString(R.string.sc_end_title), 0.5f, 0.45f, 96)
        end.layers += text(R.string.sc_k_text, ctx.getString(R.string.sc_subs_text), 0.5f, 0.6f, 44, pill)

        return Project(mutableListOf(game, soon, away, end), game.id, away.id)
    }
}
