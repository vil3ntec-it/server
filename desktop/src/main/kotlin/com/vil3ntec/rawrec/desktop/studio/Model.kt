package com.vil3ntec.rawrec.desktop.studio

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.UUID

/**
 * The studio as data: the canvas (fixed for a whole recording or stream — the picture never changes
 * size mid-way), the sources (what can be shown) and the scenes (which source where). Immutable: the
 * window changes it by making a new one, the picture thread reads whichever is current.
 */
enum class SourceKind { PHONE, WEBCAM, SCREEN, VIDEO, IMAGE, SLIDESHOW, TEXT, COLOR, CHAT, ALERTS, COUNTER, GOAL }

/** How a picture fills its box when their shapes differ (the phone turns): whole inside, filling, or stretched. */
enum class Fit { CONTAIN, COVER, STRETCH }

data class SourceDef(val id: String, val kind: SourceKind, val name: String, val props: Map<String, String> = emptyMap()) {
    fun prop(k: String, def: String = "") = props[k] ?: def
    fun with(k: String, v: String) = copy(props = props + (k to v))
}

/** Cut from each side of the picture, as a share of it (0..0.45). */
data class Crop(val l: Float = 0f, val t: Float = 0f, val r: Float = 0f, val b: Float = 0f)

/**
 * A layer's picture effects, all in one pass on the picture: green screen (keyed colour removed, its
 * spill taken out of the edges), colour correction, sharpening. Defaults change nothing.
 */
data class Fx(
    val key: Boolean = false, val keyColor: Int = 0xFF00FF00.toInt(), val similarity: Float = 0.40f, val smoothness: Float = 0.08f, val spill: Float = 0.10f,
    val brightness: Float = 0f, val contrast: Float = 1f, val saturation: Float = 1f, val gamma: Float = 1f, val hue: Float = 0f,
    val sharpen: Float = 0f,
) {
    val active get() = this != Fx()
}

enum class Transition { CUT, FADE, SLIDE, ZOOM }

/** One source placed on the canvas, in canvas pixels; [rot] degrees around the centre. */
data class Layer(
    val id: String, val sourceId: String,
    val x: Float, val y: Float, val w: Float, val h: Float,
    val rot: Float = 0f, val crop: Crop = Crop(), val opacity: Float = 1f,
    val visible: Boolean = true, val locked: Boolean = false,
    val radius: Float = 0f, val fit: Fit = Fit.CONTAIN, val fx: Fx = Fx(),
)

/** [layers] bottom to top. */
data class Scene(val id: String, val name: String, val layers: List<Layer>)

data class Studio(
    val width: Int = 1920, val height: Int = 1080, val fps: Int = 60,
    val sources: List<SourceDef>, val scenes: List<Scene>, val current: String,
    /** How the program goes from one scene to the next. */
    val transition: Transition = Transition.FADE, val transitionMs: Int = 400,
    /** Studio mode: the scene being prepared (shown beside the program, not sent until «go»); null = off. */
    val preview: String? = null,
) {
    val scene: Scene get() = scenes.firstOrNull { it.id == current } ?: scenes.first()
    /** The scene the owner edits: the prepared one in studio mode, else the one on air. */
    val editing: Scene get() = preview?.let { p -> scenes.firstOrNull { it.id == p } } ?: scene
    fun sceneById(id: String?) = scenes.firstOrNull { it.id == id }
    fun source(id: String) = sources.firstOrNull { it.id == id }

    fun withScene(s: Scene) = copy(scenes = scenes.map { if (it.id == s.id) s else it })
    fun withLayer(l: Layer) = withScene(editing.copy(layers = editing.layers.map { if (it.id == l.id) l else it }))
    fun withSource(s: SourceDef) = copy(sources = sources.map { if (it.id == s.id) s else it })

    /** A new source on the current scene, on top, in a sensible place for its kind. */
    fun add(kind: SourceKind, name: String, props: Map<String, String> = emptyMap()): Pair<Studio, Layer> {
        val src = SourceDef(newId(), kind, name, props)
        val (w, h) = when (kind) {
            SourceKind.PHONE, SourceKind.VIDEO, SourceKind.COLOR, SourceKind.SCREEN, SourceKind.SLIDESHOW -> width.toFloat() to height.toFloat()
            SourceKind.COUNTER -> width * 0.16f to height * 0.07f
            SourceKind.GOAL -> width * 0.3f to height * 0.08f
            SourceKind.WEBCAM -> width * 0.25f to width * 0.25f * 9 / 16
            SourceKind.CHAT -> width * 0.26f to height * 0.55f
            SourceKind.ALERTS -> width * 0.4f to height * 0.18f
            SourceKind.TEXT -> width * 0.4f to height * 0.1f
            SourceKind.IMAGE -> width * 0.3f to height * 0.3f
        }
        val (x, y) = when (kind) {
            SourceKind.WEBCAM -> width - w - width * 0.02f to height - h - height * 0.03f
            SourceKind.CHAT -> width * 0.02f to height * 0.3f
            SourceKind.ALERTS -> (width - w) / 2 to height * 0.06f
            SourceKind.TEXT -> width * 0.03f to height * 0.04f
            SourceKind.COUNTER -> width - w - width * 0.02f to height * 0.03f
            SourceKind.GOAL -> width * 0.02f to height * 0.03f
            SourceKind.IMAGE -> (width - w) / 2 to (height - h) / 2
            else -> 0f to 0f
        }
        val layer = Layer(newId(), src.id, x, y, w, h, radius = if (kind == SourceKind.WEBCAM) 18f else 0f)
        val sc = editing.copy(layers = editing.layers + layer)
        return copy(sources = sources + src).withScene(sc) to layer
    }

    fun removeLayer(id: String): Studio {
        val sc = editing.copy(layers = editing.layers.filter { it.id != id })
        val used = (scenes.filter { it.id != sc.id }.flatMap { it.layers } + sc.layers).map { it.sourceId }.toSet()
        return copy(sources = sources.filter { it.id in used }).withScene(sc)
    }

    /** Move a layer one step up (toward the viewer) or down. */
    fun reorder(id: String, up: Boolean): Studio {
        val ls = editing.layers.toMutableList()
        val i = ls.indexOfFirst { it.id == id }
        val j = if (up) i + 1 else i - 1
        if (i < 0 || j !in ls.indices) return this
        ls[i] = ls[j].also { ls[j] = ls[i] }
        return withScene(editing.copy(layers = ls))
    }

    /** A copy of a layer (same source, moved a little), on top. */
    fun duplicate(id: String, dx: Float = 30f, dy: Float = 30f): Pair<Studio, Layer>? {
        val l = editing.layers.firstOrNull { it.id == id } ?: return null
        val c = l.copy(id = newId(), x = l.x + dx, y = l.y + dy)
        return withScene(editing.copy(layers = editing.layers + c)) to c
    }

    /** A layer copied from elsewhere (another scene) put in the editing scene. */
    fun paste(l: Layer): Pair<Studio, Layer>? {
        if (source(l.sourceId) == null) return null
        val c = l.copy(id = newId())
        return withScene(editing.copy(layers = editing.layers + c)) to c
    }

    fun addScene(name: String, copyOf: Scene? = null): Studio {
        val sc = Scene(newId(), name, copyOf?.layers?.map { it.copy(id = newId()) } ?: emptyList())
        return if (preview != null) copy(scenes = scenes + sc, preview = sc.id) else copy(scenes = scenes + sc, current = sc.id)
    }

    /** Another canvas size: every layer keeps its place and size relative to the canvas. */
    fun resized(w: Int, h: Int): Studio {
        val sx = w / width.toFloat(); val sy = h / height.toFloat()
        return copy(width = w, height = h, scenes = scenes.map { s ->
            s.copy(layers = s.layers.map { it.copy(x = it.x * sx, y = it.y * sy, w = it.w * sx, h = it.h * sy) })
        })
    }

    companion object {
        fun newId() = UUID.randomUUID().toString().substring(0, 8)

        /** The first start: one scene with the phone over the whole canvas. */
        fun default(): Studio {
            val phone = SourceDef("phone", SourceKind.PHONE, "گوشی")
            val l = Layer(newId(), phone.id, 0f, 0f, 1920f, 1080f)
            val main = Scene(newId(), "بازی", listOf(l))
            return Studio(sources = listOf(phone), scenes = listOf(main), current = main.id)
        }

        // ---------------------------------------------------------------- saved as JSON

        fun toJson(s: Studio): String = JSONObject().apply {
            put("v", 2); put("width", s.width); put("height", s.height); put("fps", s.fps); put("current", s.current)
            put("transition", s.transition.name); put("transitionMs", s.transitionMs); s.preview?.let { put("preview", it) }
            put("sources", JSONArray(s.sources.map { src ->
                JSONObject().put("id", src.id).put("kind", src.kind.name).put("name", src.name).put("props", JSONObject(src.props))
            }))
            put("scenes", JSONArray(s.scenes.map { sc ->
                JSONObject().put("id", sc.id).put("name", sc.name).put("layers", JSONArray(sc.layers.map { l ->
                    JSONObject().put("id", l.id).put("source", l.sourceId).put("x", l.x).put("y", l.y).put("w", l.w).put("h", l.h)
                        .put("rot", l.rot).put("opacity", l.opacity).put("visible", l.visible).put("locked", l.locked)
                        .put("radius", l.radius).put("fit", l.fit.name)
                        .put("crop", JSONArray(listOf(l.crop.l, l.crop.t, l.crop.r, l.crop.b)))
                        .also { o -> if (l.fx.active) o.put("fx", fxJson(l.fx)) }
                }))
            }))
        }.toString(2)

        fun fromJson(text: String): Studio {
            val o = JSONObject(text)
            val sources = o.getJSONArray("sources").let { a ->
                (0 until a.length()).mapNotNull { i ->
                    val s = a.getJSONObject(i)
                    val kind = runCatching { SourceKind.valueOf(s.getString("kind")) }.getOrNull() ?: return@mapNotNull null
                    val p = s.optJSONObject("props") ?: JSONObject()
                    SourceDef(s.getString("id"), kind, s.optString("name"), p.keySet().associateWith { p.optString(it) })
                }
            }
            val ids = sources.map { it.id }.toSet()
            val scenes = o.getJSONArray("scenes").let { a ->
                (0 until a.length()).map { i ->
                    val sc = a.getJSONObject(i)
                    val ls = sc.getJSONArray("layers")
                    Scene(sc.getString("id"), sc.optString("name"), (0 until ls.length()).map { ls.getJSONObject(it) }
                        .filter { it.optString("source") in ids }
                        .map { l ->
                            val c = l.optJSONArray("crop")
                            Layer(l.getString("id"), l.getString("source"),
                                l.getDouble("x").toFloat(), l.getDouble("y").toFloat(), l.getDouble("w").toFloat(), l.getDouble("h").toFloat(),
                                l.optDouble("rot", 0.0).toFloat(),
                                if (c != null && c.length() == 4) Crop(c.getDouble(0).toFloat(), c.getDouble(1).toFloat(), c.getDouble(2).toFloat(), c.getDouble(3).toFloat()) else Crop(),
                                l.optDouble("opacity", 1.0).toFloat(), l.optBoolean("visible", true), l.optBoolean("locked", false),
                                l.optDouble("radius", 0.0).toFloat(), runCatching { Fit.valueOf(l.optString("fit")) }.getOrDefault(Fit.CONTAIN),
                                l.optJSONObject("fx")?.let(::fxFrom) ?: Fx())
                        })
                }
            }
            require(scenes.isNotEmpty()) { "no scenes" }
            val w = o.optInt("width", 1920).coerceIn(320, 7680) and 1.inv()
            val h = o.optInt("height", 1080).coerceIn(320, 7680) and 1.inv()
            val ids2 = scenes.map { it.id }.toSet()
            return Studio(w, h, o.optInt("fps", 60).coerceIn(10, 120), sources, scenes,
                o.optString("current", scenes.first().id).takeIf { it in ids2 } ?: scenes.first().id,
                runCatching { Transition.valueOf(o.optString("transition")) }.getOrDefault(Transition.FADE),
                o.optInt("transitionMs", 400).coerceIn(0, 5000),
                o.optString("preview").takeIf { it.isNotBlank() && it in ids2 })
        }

        fun fxJson(f: Fx) = JSONObject().put("key", f.key).put("keyColor", f.keyColor).put("similarity", f.similarity).put("smoothness", f.smoothness)
            .put("spill", f.spill).put("brightness", f.brightness).put("contrast", f.contrast).put("saturation", f.saturation)
            .put("gamma", f.gamma).put("hue", f.hue).put("sharpen", f.sharpen)
        fun fxFrom(o: JSONObject) = Fx(o.optBoolean("key"), o.optInt("keyColor", 0xFF00FF00.toInt()), o.optDouble("similarity", 0.4).toFloat(),
            o.optDouble("smoothness", 0.08).toFloat(), o.optDouble("spill", 0.1).toFloat(), o.optDouble("brightness", 0.0).toFloat(),
            o.optDouble("contrast", 1.0).toFloat(), o.optDouble("saturation", 1.0).toFloat(), o.optDouble("gamma", 1.0).toFloat(),
            o.optDouble("hue", 0.0).toFloat(), o.optDouble("sharpen", 0.0).toFloat())

        /** Read the saved studio; a damaged file is kept aside (never lost) and the default used. */
        fun load(file: File): Studio {
            if (!file.isFile) return default()
            return try { fromJson(file.readText()) } catch (e: Exception) {
                file.copyTo(File(file.parentFile, file.name + ".broken-" + System.currentTimeMillis()), overwrite = true)
                default()
            }
        }

        /** Written whole to a side file and then moved over: a crash mid-write never leaves half a file. */
        fun save(s: Studio, file: File) {
            file.parentFile.mkdirs()
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(toJson(s))
            if (!tmp.renameTo(file)) { file.delete(); tmp.renameTo(file) }
        }
    }
}
