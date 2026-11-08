package com.vil3ntec.rawrec

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.DashPathEffect
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PointF
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.util.Size
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.io.File
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.sin

/**
 * «صحنه‌ها و لایه‌ها»: the stream's editor, like the professional streaming apps. On the left the
 * picture viewers get; on the side the scenes, the layers and the chosen layer's settings.
 *
 *  • scenes: as many as wanted (game, starting soon, be right back, ending …), any name, the game
 *    or the owner's colour / picture behind them; one is the «away» scene;
 *  • layers: text (any words, with live numbers), pictures and GIFs, videos, web pages, the chat,
 *    thank-yous, goal bars, shapes, the camera — added freely, ordered, shown or hidden, locked;
 *  • on the picture: drag to move, the corner handle or two fingers to resize, the round handle or
 *    two fingers to turn, «برش» to keep only a part; guides at the middle and the edges;
 *  • every setting free: colours from a full colour picker, sizes and fades with sliders.
 *
 * Saved at once (and undo); a stream running now takes every change immediately.
 */
class SceneEditorActivity : Activity() {

    override fun attachBaseContext(newBase: Context) = super.attachBaseContext(AppLang.wrap(newBase))

    private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()
    private fun col(id: Int) = getColor(id)
    private val ui = Handler(Looper.getMainLooper())

    internal lateinit var project: Scenes.Project
    internal var sel: String? = null
    private val undo = ArrayDeque<String>()
    internal lateinit var stage: Stage
    private lateinit var root: FrameLayout
    private lateinit var sceneRow: LinearLayout
    private lateinit var bgRow: LinearLayout
    private lateinit var body: LinearLayout
    private lateinit var tabLayers: TextView
    private lateinit var tabProps: TextView
    private var tab = 0
    private var lastFrame: Bitmap? = null
    private var pendingPick: ((Uri) -> Unit)? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        project = Scenes.reload(this)
        root = FrameLayout(this).apply { setBackgroundColor(col(R.color.bg)) }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        stage = Stage(this)
        val panel = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(col(R.color.surface))
            setPadding(dp(12), dp(8), dp(12), 0)
        }
        row.addView(panel, LinearLayout.LayoutParams(dp(340), ViewGroup.LayoutParams.MATCH_PARENT))
        row.addView(stage, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f))
        root.addView(row, FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT))

        // header: done, title, undo
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(pill(getString(R.string.lay_done), col(R.color.accent_fill), tag = "sc:done") { finish() })
        head.addView(label(getString(R.string.sc_title), 16f, bold = true), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(8) })
        head.addView(pill("↶", tag = "sc:undo") { undoLast() })
        panel.addView(head)

        sceneRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        panel.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(sceneRow) }, lpw(top = 10))
        bgRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        panel.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(bgRow) }, lpw(top = 6))

        val tabs = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(col(R.color.surface_2)) }
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }
        tabLayers = tabView(getString(R.string.sc_tab_layers), "sc:tab:layers") { tab = 0; renderPanel() }
        tabProps = tabView(getString(R.string.sc_tab_props), "sc:tab:props") { tab = 1; renderPanel() }
        tabs.addView(tabLayers, LinearLayout.LayoutParams(0, dp(40), 1f))
        tabs.addView(tabProps, LinearLayout.LayoutParams(0, dp(40), 1f))
        panel.addView(tabs, lpw(top = 10))
        body = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(0, dp(8), 0, dp(24)) }
        panel.addView(ScrollView(this).apply { addView(body); isVerticalScrollBarEnabled = false }, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))

        setContentView(root)
        if (android.os.Build.VERSION.SDK_INT >= 30) window.insetsController?.let {
            it.hide(WindowInsets.Type.systemBars()); it.systemBarsBehavior = WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
        Thread {
            val f = try { VideoLibrary.query(this).firstOrNull()?.let { contentResolver.loadThumbnail(it.uri, Size(1280, 720), null) } } catch (_: Exception) { null }
            if (f != null) ui.post { lastFrame = f; stage.invalidate() }
        }.start()
        renderScenes()
        renderPanel()
    }

    override fun onDestroy() {
        stage.release()
        if (isFinishing) Scenes.cleanMedia(this, project)
        super.onDestroy()
    }

    // ------------------------------------------------------------ small builders

    private fun lpw(top: Int = 0) = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(top) }

    private fun label(t: String, sp: Float = 13f, color: Int = col(R.color.text_primary), bold: Boolean = false) = TextView(this).apply {
        text = t; setTextSize(TypedValue.COMPLEX_UNIT_SP, sp); setTextColor(color); if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun pill(t: String, bg: Int = col(R.color.surface_3), tag: String? = null, click: () -> Unit) = TextView(this).apply {
        text = t; setTextColor(Color.WHITE); typeface = Typeface.DEFAULT_BOLD; setTextSize(TypedValue.COMPLEX_UNIT_SP, 13.5f)
        gravity = Gravity.CENTER; minWidth = dp(48); setPadding(dp(14), 0, dp(14), 0)
        background = GradientDrawable().apply { cornerRadius = dp(20).toFloat(); setColor(bg) }
        this.tag = tag
        setOnClickListener { click() }
        layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(44)).apply { marginEnd = dp(6) }
    }

    private fun tabView(t: String, tag: String, click: () -> Unit) = TextView(this).apply {
        text = t; gravity = Gravity.CENTER; setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f); typeface = Typeface.DEFAULT_BOLD
        this.tag = tag
        setOnClickListener { click() }
    }

    private fun section(t: String) = label(t, 12f, col(R.color.text_secondary), bold = true).also { body.addView(it, lpw(top = 14)) }

    /** A slider with its name and value. [onMove] while dragging (no undo step per move). */
    private fun slider(name: String, min: Int, max: Int, value: Int, fmt: (Int) -> String = { "$it" }, tag: String? = null, onMove: (Int) -> Unit) {
        val box = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        val top = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val v = label(fmt(value), 12.5f, col(R.color.text_secondary))
        top.addView(label(name, 13f), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        top.addView(v)
        box.addView(top)
        val sb = SeekBar(this).apply {
            this.max = max - min; progress = (value - min).coerceIn(0, max - min)
            progressTintList = ColorStateList.valueOf(col(R.color.sel)); thumbTintList = ColorStateList.valueOf(col(R.color.sel))
            this.tag = tag
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar, p: Int, fromUser: Boolean) { if (fromUser) { v.text = fmt(p + min); onMove(p + min) } }
                override fun onStartTrackingTouch(s: SeekBar) { snapshot() }
                override fun onStopTrackingTouch(s: SeekBar) { changed(structure = false) }
            })
        }
        box.addView(sb, lpw(top = 2))
        body.addView(box, lpw(top = 8))
    }

    private fun colorRow(name: String, value: Int, tag: String? = null, alpha: Boolean = true, onPick: (Int) -> Unit) {
        val r = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(48) }
        r.addView(label(name), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        r.addView(View(this).apply {
            background = GradientDrawable().apply { cornerRadius = dp(8).toFloat(); setColor(value); setStroke(dp(1), Color.GRAY) }
            this.tag = tag
            setOnClickListener { ColorPicker.show(this@SceneEditorActivity, name, value, alpha) { c -> snapshot(); onPick(c); changed(structure = true) } }
        }, LinearLayout.LayoutParams(dp(64), dp(36)))
        body.addView(r, lpw(top = 4))
    }

    private fun switchRow(name: String, value: Boolean, tag: String? = null, onSet: (Boolean) -> Unit) {
        val r = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(48) }
        val sw = Switch(this).apply { isChecked = value; isClickable = false; isFocusable = false }
        r.addView(label(name), LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        r.addView(sw)
        r.tag = tag
        r.setOnClickListener { snapshot(); sw.isChecked = !sw.isChecked; onSet(sw.isChecked); changed(structure = true) }
        body.addView(r, lpw(top = 2))
    }

    private fun chips(name: String?, labels: List<String>, selected: Int, tag: String? = null, onPick: (Int) -> Unit) {
        if (name != null) body.addView(label(name), lpw(top = 8))
        val r = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for ((i, l) in labels.withIndex()) r.addView(pill(l, if (i == selected) col(R.color.sel_strong) else col(R.color.surface_3), tag?.let { "$it:$i" }) {
            snapshot(); onPick(i); changed(structure = true)
        })
        body.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(r) }, lpw(top = 4))
    }

    private fun field(name: String, value: String, multi: Boolean = false, number: Boolean = false, ltr: Boolean = false, tag: String? = null, onSet: (String) -> Unit) {
        body.addView(label(name), lpw(top = 8))
        val e = EditText(this).apply {
            setText(value)
            setTextColor(col(R.color.text_primary)); setHintTextColor(col(R.color.text_tertiary))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
            background = GradientDrawable().apply { cornerRadius = dp(10).toFloat(); setColor(col(R.color.surface_2)) }
            setPadding(dp(12), dp(10), dp(12), dp(10))
            textDirection = if (ltr) View.TEXT_DIRECTION_LTR else View.TEXT_DIRECTION_FIRST_STRONG
            inputType = when {
                number -> InputType.TYPE_CLASS_NUMBER
                multi -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE
                ltr -> InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
                else -> InputType.TYPE_CLASS_TEXT
            }
            if (multi) { minLines = 2; maxLines = 6 } else setSingleLine()
            this.tag = tag
            var first = true
            addTextChangedListener(object : TextWatcher {
                override fun afterTextChanged(s: Editable?) { if (first) { snapshot(); first = false }; onSet(s.toString()); changed(structure = false) }
                override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
                override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            })
        }
        body.addView(e, lpw(top = 4))
    }

    private fun buttons(vararg b: Pair<String, () -> Unit>) {
        val r = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for ((t, f) in b) r.addView(pill(t) { f() })
        body.addView(HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false; addView(r) }, lpw(top = 8))
    }

    // ------------------------------------------------------------ saving, undo

    /** The scene open here (looking at a scene does not put it on the stream: «▶» marks the one a stream starts with). */
    internal var editing = ""
    internal fun scene() = project.scene(editing) ?: project.startScene.also { editing = it.id }
    internal fun layer() = scene().layers.firstOrNull { it.id == sel }

    /** Before a change: remembered for «↶». */
    internal fun snapshot() {
        undo.addLast(project.toJson().toString())
        while (undo.size > 40) undo.removeFirst()
    }

    private fun undoLast() {
        val s = undo.removeLastOrNull() ?: return
        project = Scenes.projectFromJson(org.json.JSONObject(s))
        if (layer() == null) sel = null
        changed(structure = true)
    }

    private val saveR = Runnable { Scenes.save(this, project); RecordService.layoutChanged() }

    /** Something changed: drawn now, saved a moment later (a stream running now follows). */
    internal fun changed(structure: Boolean) {
        stage.invalidate()
        ui.removeCallbacks(saveR)
        ui.postDelayed(saveR, 250)
        if (structure) { renderScenes(); renderPanel() }
    }

    override fun onPause() {
        super.onPause()
        ui.removeCallbacks(saveR)
        Scenes.save(this, project)
        RecordService.layoutChanged()
    }

    // ------------------------------------------------------------ scenes

    private fun renderScenes() {
        sceneRow.removeAllViews()
        for (s in project.scenes) {
            val on = s.id == scene().id
            val name = (if (s.id == project.start) "▶ " else "") + (if (s.id == project.away) "⏸ " else "") + s.name
            sceneRow.addView(pill(name, if (on) col(R.color.accent_fill) else col(R.color.surface_3), "sc:scene:${s.name}") {
                if (on) sceneMenu(s) else { editing = s.id; sel = null; cropOff(); renderScenes(); renderPanel(); stage.invalidate() }
            }.apply { setOnLongClickListener { sceneMenu(s); true } })
        }
        sceneRow.addView(pill("+", tag = "sc:scene:add") {
            snapshot()
            val s = Scenes.Scene(Scenes.newId(), getString(R.string.sc_scene_new_fmt, project.scenes.size + 1))
            project.scenes += s; editing = s.id; sel = null
            changed(structure = true)
        })
        // what is behind the layers of this scene
        bgRow.removeAllViews()
        val s = scene()
        bgRow.addView(label(getString(R.string.sc_bg), 12.5f, col(R.color.text_secondary)), LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { marginEnd = dp(8) })
        bgRow.addView(pill(getString(R.string.sc_bg_game), if (s.game) col(R.color.sel_strong) else col(R.color.surface_3), "sc:bg:game") { snapshot(); s.game = true; changed(structure = true) })
        bgRow.addView(pill(getString(R.string.sc_bg_color), if (!s.game && s.bgImage.isBlank()) col(R.color.sel_strong) else col(R.color.surface_3), "sc:bg:color") {
            ColorPicker.show(this, getString(R.string.sc_bg_color), s.bg, alpha = false) { c -> snapshot(); s.game = false; s.bg = c; s.bgImage = ""; changed(structure = true) }
        })
        bgRow.addView(pill(getString(R.string.sc_bg_image), if (!s.game && s.bgImage.isNotBlank()) col(R.color.sel_strong) else col(R.color.surface_3), "sc:bg:image") {
            pick("image/*") { u -> copyMedia(u) { f -> snapshot(); s.game = false; s.bgImage = f; changed(structure = true) } }
        })
    }

    private fun sceneMenu(s: Scenes.Scene) {
        val items = arrayOf(getString(R.string.sc_rename), getString(R.string.sc_duplicate), getString(R.string.sc_set_away), getString(R.string.sc_delete),
            getString(R.string.sc_set_start))
        AlertDialog.Builder(this).setTitle(s.name).setItems(items) { _, i ->
            when (i) {
                0 -> ask(getString(R.string.sc_rename), s.name) { n -> snapshot(); s.name = n.ifBlank { s.name }; changed(structure = true) }
                1 -> {
                    snapshot()
                    val c = Scenes.Scene(Scenes.newId(), s.name + " ۲", s.game, s.bg, s.bgImage, s.layers.map { it.copy() }.toMutableList())
                    project.scenes.add(project.scenes.indexOf(s) + 1, c); editing = c.id; sel = null
                    changed(structure = true)
                }
                2 -> { snapshot(); project.away = s.id; changed(structure = true) }
                3 -> if (project.scenes.size > 1) {
                    snapshot()
                    project.scenes.remove(s)
                    if (project.active == s.id) project.active = project.scenes.first().id
                    if (project.start == s.id) project.start = (project.scenes.firstOrNull { it.game } ?: project.scenes.first()).id
                    if (project.away == s.id) project.away = project.scenes.firstOrNull { !it.game }?.id ?: project.scenes.first().id
                    if (editing == s.id) editing = project.start
                    sel = null
                    changed(structure = true)
                }
                4 -> { snapshot(); project.start = s.id; changed(structure = true) }
            }
        }.show()
    }

    private fun ask(title: String, value: String, done: (String) -> Unit) {
        val e = EditText(this).apply { setText(value); setSingleLine(); setSelection(value.length) }
        AlertDialog.Builder(this).setTitle(title).setView(FrameLayout(this).apply { setPadding(dp(20), dp(8), dp(20), 0); addView(e) })
            .setPositiveButton(R.string.lay_save) { _, _ -> done(e.text.toString().trim()) }
            .setNegativeButton(R.string.cancel, null).show()
    }

    // ------------------------------------------------------------ the side panel

    private fun cropOff() { if (::stage.isInitialized) stage.cropping = false }

    internal fun select(id: String?, toProps: Boolean = true) {
        sel = id
        if (id != null && toProps) tab = 1
        stage.invalidate()
        renderPanel()
    }

    private fun renderPanel() {
        val on = col(R.color.sel_strong); val off = Color.TRANSPARENT
        (tabLayers.background as? GradientDrawable ?: GradientDrawable().also { tabLayers.background = it }).apply { cornerRadius = dp(10).toFloat(); setColor(if (tab == 0) on else off) }
        (tabProps.background as? GradientDrawable ?: GradientDrawable().also { tabProps.background = it }).apply { cornerRadius = dp(10).toFloat(); setColor(if (tab == 1) on else off) }
        tabLayers.setTextColor(Color.WHITE); tabProps.setTextColor(if (layer() != null) Color.WHITE else col(R.color.text_tertiary))
        body.removeAllViews()
        if (tab == 0 || layer() == null) renderLayers() else renderProps(layer()!!)
    }

    private fun renderLayers() {
        body.addView(pill(getString(R.string.sc_add), col(R.color.accent_fill), "sc:add") { addDialog() }.apply {
            layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48))
        })
        val s = scene()
        if (s.layers.isEmpty()) body.addView(label(getString(R.string.sc_empty), 12.5f, col(R.color.text_secondary)), lpw(top = 12))
        // front first, as the picture shows them
        for (l in s.layers.reversed()) {
            val r = LinearLayout(this).apply {
                orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; minimumHeight = dp(52)
                setPadding(dp(8), 0, dp(4), 0)
                background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(if (l.id == sel) col(R.color.sel_soft) else col(R.color.surface_2)) }
                tag = "sc:layer:${l.name}"
                setOnClickListener { select(l.id) }
            }
            r.addView(ImageView(this).apply { setImageResource(Scenes.kindIcon(l.kind)); imageTintList = ColorStateList.valueOf(col(R.color.text_secondary)) }, LinearLayout.LayoutParams(dp(20), dp(20)))
            r.addView(label(l.name, 13.5f, if (l.visible) col(R.color.text_primary) else col(R.color.text_tertiary)).apply { maxLines = 1 },
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(10) })
            r.addView(icon(if (l.visible) R.drawable.ic_eye else R.drawable.ic_eye_off, "sc:eye:${l.name}") { snapshot(); l.visible = !l.visible; changed(structure = true) })
            r.addView(icon(if (l.locked) R.drawable.ic_shield else R.drawable.ic_tune, "sc:lock:${l.name}", dim = !l.locked) { snapshot(); l.locked = !l.locked; changed(structure = true) })
            body.addView(r, lpw(top = 6))
        }
    }

    private fun icon(res: Int, tag: String, dim: Boolean = false, click: () -> Unit) = ImageView(this).apply {
        setImageResource(res); imageTintList = ColorStateList.valueOf(if (dim) col(R.color.text_tertiary) else col(R.color.text_primary))
        setPadding(dp(12), dp(12), dp(12), dp(12))
        this.tag = tag
        setOnClickListener { click() }
        layoutParams = LinearLayout.LayoutParams(dp(44), dp(44))
    }

    /** What can be added: every kind, and ready-made texts with live numbers. */
    private fun addDialog() {
        class Choice(val name: String, val desc: String, val make: () -> Scenes.Layer)
        fun txt(t: String, name: Int) = { Scenes.newLayer(this, Scenes.Kind.TEXT).apply { p.put("text", t); this.name = getString(name) } }
        val choices = listOf(
            Choice(getString(R.string.sc_k_text), getString(R.string.sc_d_text)) { Scenes.newLayer(this, Scenes.Kind.TEXT) },
            Choice(getString(R.string.sc_k_counter), getString(R.string.sc_d_counter), txt(getString(R.string.sc_subs_text), R.string.lay_subs)),
            Choice(getString(R.string.sc_k_clock), getString(R.string.sc_d_clock), txt("{time}", R.string.sc_k_clock)),
            Choice(getString(R.string.sc_k_image), getString(R.string.sc_d_image)) { Scenes.newLayer(this, Scenes.Kind.IMAGE) },
            Choice(getString(R.string.sc_k_video), getString(R.string.sc_d_video)) { Scenes.newLayer(this, Scenes.Kind.VIDEO) },
            Choice(getString(R.string.sc_k_web), getString(R.string.sc_d_web)) { Scenes.newLayer(this, Scenes.Kind.WEB) },
            Choice(getString(R.string.sc_k_chat), getString(R.string.sc_d_chat)) { Scenes.newLayer(this, Scenes.Kind.CHAT) },
            Choice(getString(R.string.sc_k_alerts), getString(R.string.sc_d_alerts)) { Scenes.newLayer(this, Scenes.Kind.ALERTS) },
            Choice(getString(R.string.sc_k_goal), getString(R.string.sc_d_goal)) { Scenes.newLayer(this, Scenes.Kind.GOAL) },
            Choice(getString(R.string.sc_k_shape), getString(R.string.sc_d_shape)) { Scenes.newLayer(this, Scenes.Kind.SHAPE) },
            Choice(getString(R.string.sc_k_camera), getString(R.string.sc_d_camera)) { Scenes.newLayer(this, Scenes.Kind.CAMERA) },
        )
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(16), dp(4), dp(16), dp(4)) }
        lateinit var dlg: AlertDialog
        for (c in choices) list.addView(LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; setPadding(dp(12), dp(10), dp(12), dp(10))
            background = GradientDrawable().apply { cornerRadius = dp(12).toFloat(); setColor(col(R.color.surface_2)) }
            tag = "sc:addkind:${c.name}"
            addView(label(c.name, 14.5f, bold = true))
            addView(label(c.desc, 12f, col(R.color.text_secondary)))
            setOnClickListener {
                dlg.dismiss()
                snapshot()
                val l = c.make()
                scene().layers += l
                select(l.id)
                changed(structure = true)
                when (l.kind) {
                    Scenes.Kind.IMAGE -> pick("image/*") { u -> copyMedia(u) { l.p.put("file", it); changed(structure = true) } }
                    Scenes.Kind.VIDEO -> pick("video/*") { u -> copyMedia(u) { l.p.put("file", it); changed(structure = true) } }
                    // the camera on the stream needs the permission before the stream starts
                    Scenes.Kind.CAMERA -> if (checkSelfPermission(android.Manifest.permission.CAMERA) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                        requestPermissions(arrayOf(android.Manifest.permission.CAMERA), REQ_CAM)
                    else -> {}
                }
            }
        }, lpw(top = 6))
        dlg = AlertDialog.Builder(this).setTitle(R.string.sc_add).setView(ScrollView(this).apply { addView(list) }).setNegativeButton(R.string.cancel, null).show()
    }

    private fun pct(v: Int) = "$v%"

    /** The chosen layer's settings: shared ones, then its own. */
    private fun renderProps(l: Scenes.Layer) {
        field(getString(R.string.sc_name), l.name, tag = "sc:p:name") { l.name = it; ui.removeCallbacks(nameR); ui.postDelayed(nameR, 600) }
        buttons(
            getString(R.string.sc_front) to { snapshot(); order(l, +1) },
            getString(R.string.sc_back) to { snapshot(); order(l, -1) },
            getString(R.string.sc_duplicate) to { snapshot(); val c = l.copy(); c.x = (c.x + 0.03f).coerceAtMost(1f); c.y = (c.y + 0.03f).coerceAtMost(1f); scene().layers.add(scene().layers.indexOf(l) + 1, c); select(c.id); changed(structure = true) },
            getString(R.string.sc_delete) to { snapshot(); scene().layers.remove(l); sel = null; tab = 0; changed(structure = true) },
        )
        if (l.kind in listOf(Scenes.Kind.IMAGE, Scenes.Kind.VIDEO, Scenes.Kind.WEB, Scenes.Kind.CAMERA)) buttons(
            (if (stage.cropping) getString(R.string.sc_crop_done) else getString(R.string.sc_crop)) to { stage.cropping = !stage.cropping; stage.invalidate(); renderPanel() },
            getString(R.string.sc_crop_reset) to { snapshot(); l.crop = floatArrayOf(0f, 0f, 1f, 1f); changed(structure = true) },
        )
        section(getString(R.string.sc_s_place))
        slider(getString(R.string.sc_opacity), 0, 100, (l.alpha * 100).toInt(), ::pct, "sc:p:alpha") { l.alpha = it / 100f; changed(false) }
        slider(getString(R.string.sc_size), 10, 400, (l.scale * 100).toInt(), ::pct, "sc:p:scale") { l.scale = it / 100f; changed(false) }
        slider(getString(R.string.sc_rotation), -180, 180, l.rot.toInt(), { "$it°" }, "sc:p:rot") { l.rot = it.toFloat(); changed(false) }
        buttons(getString(R.string.sc_center) to { snapshot(); l.x = 0.5f; l.y = 0.5f; changed(false) },
            getString(R.string.sc_straight) to { snapshot(); l.rot = 0f; l.scale = 1f; changed(structure = true) })
        // the same thing on the owner's own screen while live (display only)
        if (l.kind != Scenes.Kind.VIDEO && l.kind != Scenes.Kind.CAMERA) {
            switchRow(getString(R.string.sc_mine), Scenes.mine(l), "sc:p:mine") { l.p.put("mine", it) }
            body.addView(label(getString(R.string.sc_mine_hint), 12f, col(R.color.text_secondary)), lpw(top = 2))
        }
        section(getString(R.string.sc_s_look))
        when (l.kind) {
            Scenes.Kind.TEXT -> textProps(l)
            Scenes.Kind.IMAGE -> {
                buttons(getString(R.string.sc_pick_image) to { pick("image/*") { u -> copyMedia(u) { snapshot(); l.p.put("file", it); changed(structure = true) } } })
                body.addView(label(getString(R.string.sc_image_hint), 12f, col(R.color.text_secondary)), lpw(top = 4))
                slider(getString(R.string.sc_corner), 0, 540, l.int("radius", 0)) { l.p.put("radius", it); changed(false) }
            }
            Scenes.Kind.VIDEO -> {
                buttons(getString(R.string.sc_pick_video) to { pick("video/*") { u -> copyMedia(u) { snapshot(); l.p.put("file", it); changed(structure = true) } } })
                switchRow(getString(R.string.sc_loop), l.bool("loop", true)) { l.p.put("loop", it) }
                slider(getString(R.string.sc_corner), 0, 540, l.int("radius", 0)) { l.p.put("radius", it); changed(false) }
                body.addView(label(getString(R.string.sc_video_hint), 12f, col(R.color.text_secondary)), lpw(top = 4))
            }
            Scenes.Kind.WEB -> {
                field(getString(R.string.sc_url), l.str("url"), ltr = true, tag = "sc:p:url") { l.p.put("url", it.trim()) }
                body.addView(label(getString(R.string.sc_web_hint), 12f, col(R.color.text_secondary)), lpw(top = 4))
                slider(getString(R.string.sc_web_w), 320, 1920, l.int("vw", 1280)) { l.p.put("vw", it); changed(false) }
                slider(getString(R.string.sc_web_h), 180, 1920, l.int("vh", 720)) { l.p.put("vh", it); changed(false) }
                slider(getString(R.string.sc_zoom), 25, 300, l.int("zoom", 100), ::pct) { l.p.put("zoom", it); changed(false) }
                slider(getString(R.string.sc_fps), 1, 15, l.int("fps", 4), { getString(R.string.sc_fps_fmt, it) }) { l.p.put("fps", it); changed(false) }
                switchRow(getString(R.string.sc_transparent), l.bool("transparent", true)) { l.p.put("transparent", it) }
                field(getString(R.string.sc_css), l.str("css"), multi = true, ltr = true) { l.p.put("css", it) }
                buttons(getString(R.string.sc_reload) to { stage.reloadWeb(l.id) })
            }
            Scenes.Kind.CHAT -> {
                chips(getString(R.string.sc_chat_style), listOf(getString(R.string.live_style_bare), getString(R.string.live_style_glass), getString(R.string.live_style_bubbles)), l.int("style", 1)) { l.p.put("style", it) }
                slider(getString(R.string.sc_font_size), 14, 80, l.int("size", 29)) { l.p.put("size", it); changed(false) }
                slider(getString(R.string.sc_lines), 1, 15, l.int("lines", 6)) { l.p.put("lines", it); changed(false) }
                slider(getString(R.string.sc_width), 250, 1600, l.int("width", 600)) { l.p.put("width", it); changed(false) }
                colorRow(getString(R.string.sc_text_color), l.int("color", Color.WHITE)) { l.p.put("color", it) }
                slider(getString(R.string.sc_bg_opacity), 0, 255, l.int("bgAlpha", 200), { "${it * 100 / 255}%" }) { l.p.put("bgAlpha", it); changed(false) }
            }
            Scenes.Kind.ALERTS -> {
                slider(getString(R.string.sc_duration), 2, 30, l.int("dur", 6), { getString(R.string.sc_sec_fmt, it) }) { l.p.put("dur", it); changed(false) }
                colorRow(getString(R.string.sc_accent), l.int("color", 0).takeIf { it != 0 } ?: Color.rgb(255, 59, 71), alpha = false) { l.p.put("color", it) }
                buttons(getString(R.string.sc_accent_auto) to { snapshot(); l.p.put("color", 0); changed(structure = true) },
                    getString(R.string.sc_alert_pic) to { pick("image/*") { u -> copyMedia(u) { snapshot(); l.p.put("image", it); changed(structure = true) } } },
                    getString(R.string.sc_alert_pic_none) to { snapshot(); l.p.put("image", ""); changed(structure = true) })
                body.addView(label(getString(R.string.sc_alert_vars), 12f, col(R.color.text_secondary)), lpw(top = 8))
                for ((key, name) in listOf("t_sub" to R.string.sc_t_sub_name, "t_super" to R.string.sc_t_super_name, "t_member" to R.string.sc_t_member_name,
                        "t_gift" to R.string.sc_t_gift_name, "t_cheer" to R.string.sc_t_cheer_name, "t_raid" to R.string.sc_t_raid_name,
                        "t_give" to R.string.sc_t_give_name, "t_goal" to R.string.sc_t_goal_name))
                    field(getString(name), l.str(key)) { l.p.put(key, it); stage.alertSample = key }
            }
            Scenes.Kind.GOAL -> {
                field(getString(R.string.sc_goal_title), l.str("title"), tag = "sc:p:goaltitle") { l.p.put("title", it) }
                val counts = listOf("subs", "likes", "viewers", "members", "supers", "manual")
                chips(getString(R.string.sc_goal_counts), listOf(R.string.live_goal_t_subs, R.string.live_goal_t_likes, R.string.sc_goal_viewers,
                    R.string.live_goal_t_members, R.string.sc_goal_supers, R.string.live_goal_t_manual).map { getString(it) },
                    counts.indexOf(l.str("count", "subs")).coerceAtLeast(0), "sc:p:count") { l.p.put("count", counts[it]) }
                switchRow(getString(R.string.sc_goal_since), l.bool("since", false)) { l.p.put("since", it) }
                field(getString(R.string.live_goal_target), l.int("target", 1000).toString(), number = true, tag = "sc:p:target") {
                    ChatBot.toAsciiDigits(it.trim()).toIntOrNull()?.takeIf { v -> v > 0 }?.let { v -> l.p.put("target", v) }
                }
                colorRow(getString(R.string.sc_bar1), l.int("c1", Color.rgb(255, 59, 71)), alpha = false) { l.p.put("c1", it) }
                colorRow(getString(R.string.sc_bar2), l.int("c2", Color.rgb(255, 176, 32)), alpha = false) { l.p.put("c2", it) }
                colorRow(getString(R.string.sc_text_color), l.int("color", Color.WHITE)) { l.p.put("color", it) }
                slider(getString(R.string.sc_width), 250, 1600, l.int("width", 600)) { l.p.put("width", it); changed(false) }
                slider(getString(R.string.sc_bg_opacity), 0, 255, l.int("bgAlpha", 200), { "${it * 100 / 255}%" }) { l.p.put("bgAlpha", it); changed(false) }
                switchRow(getString(R.string.sc_goal_pct), l.bool("pct", true)) { l.p.put("pct", it) }
            }
            Scenes.Kind.SHAPE -> {
                slider(getString(R.string.sc_width), 4, 2600, l.int("w", 600)) { l.p.put("w", it); changed(false) }
                slider(getString(R.string.sc_height), 4, 1080, l.int("h", 120)) { l.p.put("h", it); changed(false) }
                colorRow(getString(R.string.sc_fill), l.int("color", Color.argb(200, 14, 15, 20))) { l.p.put("color", it) }
                slider(getString(R.string.sc_corner), 0, 540, l.int("radius", 24)) { l.p.put("radius", it); changed(false) }
                colorRow(getString(R.string.sc_border), l.int("border", Color.WHITE)) { l.p.put("border", it) }
                slider(getString(R.string.sc_border_w), 0, 40, l.int("borderW", 2)) { l.p.put("borderW", it); changed(false) }
            }
            Scenes.Kind.CAMERA -> {
                chips(getString(R.string.sc_camera_which), listOf(getString(R.string.sc_cam_front), getString(R.string.sc_cam_back)), if (l.bool("front", true)) 0 else 1) { l.p.put("front", it == 0) }
                chips(getString(R.string.sc_camera_mask), listOf(getString(R.string.sc_mask_rect), getString(R.string.sc_mask_round), getString(R.string.sc_mask_circle)), l.int("mask", 1)) { l.p.put("mask", it) }
                switchRow(getString(R.string.sc_mirror), l.bool("mirror", true)) { l.p.put("mirror", it) }
                body.addView(label(getString(R.string.sc_camera_hint), 12f, col(R.color.text_secondary)), lpw(top = 4))
            }
        }
    }

    private val nameR = Runnable { renderScenes() }

    private fun textProps(l: Scenes.Layer) {
        field(getString(R.string.sc_text), l.str("text"), multi = true, tag = "sc:p:text") { l.p.put("text", it) }
        body.addView(label(getString(R.string.sc_vars), 12f, col(R.color.text_secondary)), lpw(top = 4))
        slider(getString(R.string.sc_font_size), 10, 240, l.int("size", 56), tag = "sc:p:fontsize") { l.p.put("size", it); changed(false) }
        colorRow(getString(R.string.sc_text_color), l.int("color", Color.WHITE), "sc:p:color") { l.p.put("color", it) }
        colorRow(getString(R.string.sc_text_bg), l.int("bg", 0)) { l.p.put("bg", it) }
        switchRow(getString(R.string.sc_bold), l.bool("bold", true)) { l.p.put("bold", it) }
        chips(getString(R.string.sc_font), listOf(R.string.sc_f_sans, R.string.sc_f_serif, R.string.sc_f_mono, R.string.sc_f_condensed, R.string.sc_f_black).map { getString(it) }, l.int("font", 0)) { l.p.put("font", it) }
        chips(getString(R.string.sc_align), listOf(R.string.sc_a_start, R.string.sc_a_center, R.string.sc_a_end).map { getString(it) }, l.int("align", 1)) { l.p.put("align", it) }
        slider(getString(R.string.sc_shadow), 0, 100, (l.num("shadow", 0.8f) * 100).toInt(), ::pct) { l.p.put("shadow", it / 100.0); changed(false) }
        slider(getString(R.string.sc_padding), 0, 80, l.int("pad", 16)) { l.p.put("pad", it); changed(false) }
        slider(getString(R.string.sc_corner), 0, 120, l.int("radius", 18)) { l.p.put("radius", it); changed(false) }
        slider(getString(R.string.sc_wrap), 0, 1880, l.int("maxw", 0), { if (it == 0) getString(R.string.sc_auto) else "$it" }) { l.p.put("maxw", it); changed(false) }
    }

    private fun order(l: Scenes.Layer, d: Int) {
        val list = scene().layers
        val i = list.indexOf(l)
        val j = (i + d).coerceIn(0, list.size - 1)
        if (i == j) return
        list.removeAt(i); list.add(j, l)
        changed(structure = true)
    }

    // ------------------------------------------------------------ media

    private fun pick(type: String, done: (Uri) -> Unit) {
        pendingPick = done
        try { @Suppress("DEPRECATION") startActivityForResult(Intent(Intent.ACTION_GET_CONTENT).setType(type).addCategory(Intent.CATEGORY_OPENABLE), REQ_PICK) }
        catch (_: Exception) { pendingPick = null }   // no gallery / files app on this phone
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION") super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_PICK) return
        val u = data?.data
        val f = pendingPick
        pendingPick = null
        if (resultCode == RESULT_OK && u != null && f != null) f(u)
    }

    /**
     * A copy of the picked file next to the scenes (the original may move or vanish), made off the
     * main thread (a long video takes a while); [done] gets its path on the main thread.
     */
    private fun copyMedia(u: Uri, done: (String) -> Unit) {
        Toast.makeText(this, R.string.sc_loading, Toast.LENGTH_SHORT).show()
        Thread {
            val path = try {
                val ext = contentResolver.getType(u)?.substringAfter('/')?.substringBefore(';')?.substringBefore('+')?.take(5) ?: "bin"
                val f = File(Scenes.mediaDir(this), Scenes.newId() + "." + ext)
                contentResolver.openInputStream(u)?.use { i -> f.outputStream().use { i.copyTo(it) } }
                f.path.takeIf { f.length() > 0 }
            } catch (_: Exception) { null }
            ui.post { if (!isDestroyed && path != null) done(path) }
        }.start()
    }

    // ------------------------------------------------------------ the picture

    /** The 16:9 picture with the scene's layers, drawn like the stream; drag, resize, turn, crop. */
    @SuppressLint("ViewConstructor")
    inner class Stage(ctx: Context) : View(ctx) {
        private val d = resources.displayMetrics.density
        private val frame = RectF()
        private val pics = HashMap<String, Pair<String, Bitmap?>>()
        private val webs = HashMap<String, WebSource>()
        private val webPics = HashMap<String, Bitmap>()
        private val thumbs = HashMap<String, Bitmap?>()
        private val data = LayerPainter.Data().apply { subs = 12_345; viewers = 1_234; likes = 890; members = 7; supers = 3; startedAt = System.currentTimeMillis() - 3_725_000; lastSub = "Sara_99"; lastSuper = "Navid" }
        var cropping = false
        var alertSample = "t_sub"
        private val paint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
        private val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2f * d; color = Color.WHITE; pathEffect = DashPathEffect(floatArrayOf(8f * d, 6f * d), 0f) }
        private val handle = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.WHITE }
        private val handleRing = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 2f * d; color = Color.rgb(106, 166, 255) }
        private val guide = Paint().apply { color = Color.rgb(106, 166, 255); strokeWidth = 1.5f * d }
        private val dim = Paint().apply { color = Color.argb(150, 0, 0, 0) }
        private val hint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(220, 255, 255, 255); textSize = 13f * d; textAlign = Paint.Align.CENTER; setShadowLayer(4f * d, 0f, 0f, Color.BLACK) }
        private var guideX = false
        private var guideY = false

        fun release() { for (w in webs.values) w.release(); webs.clear() }
        fun reloadWeb(id: String) { webs[id]?.reload() }

        /** The stream's own shape (this phone's screen sideways): what is placed here is where it is on the stream. */
        private val aspect = Scenes.aspect(ctx)

        override fun onSizeChanged(w: Int, h: Int, ow: Int, oh: Int) {
            val pad = 12 * d
            var fw = w - 2 * pad
            var fh = fw / aspect
            if (fh > h - 2 * pad) { fh = h - 2 * pad; fw = fh * aspect }
            frame.set((w - fw) / 2f, (h - fh) / 2f, (w + fw) / 2f, (h + fh) / 2f)
        }

        /** View pixels per pixel of a frame 1080 high. */
        private val k get() = frame.height() / 1080f

        /** The layer's picture as it would be on the stream (sample numbers and messages in the editor). */
        private fun pic(l: Scenes.Layer): Bitmap? {
            return when (l.kind) {
                Scenes.Kind.WEB -> {
                    val w = webs.getOrPut(l.id) { WebSource(this@SceneEditorActivity, WebSource.InParent(root)) { b -> webPics[l.id] = b; invalidate() } }
                    w.configure(l)
                    webPics[l.id] ?: LayerPainter.placeholder(context, l.int("vw", 1280).coerceIn(200, 1920), l.int("vh", 720).coerceIn(150, 1080),
                        if (l.str("url").startsWith("http")) getString(R.string.sc_loading) else getString(R.string.sc_k_web), 0)
                }
                Scenes.Kind.VIDEO -> videoThumb(l.str("file")) ?: LayerPainter.placeholder(context, 1280, 720, getString(R.string.sc_k_video), 0)
                Scenes.Kind.CAMERA -> camPic
                else -> {
                    val sig = l.p.toString() + if (l.kind == Scenes.Kind.ALERTS) alertSample else ""
                    pics[l.id]?.let { if (it.first == sig) return it.second }
                    val alert = if (l.kind == Scenes.Kind.ALERTS) sampleAlert() else null
                    val b = LayerPainter.paint(context, l, data, alert, sample = true)
                        ?: if (l.kind == Scenes.Kind.IMAGE) LayerPainter.placeholder(context, 800, 450, getString(R.string.sc_pick_image), 0) else null
                    pics[l.id] = sig to b
                    b
                }
            }
        }

        private val camPic by lazy { LayerPainter.placeholder(context, 1280, 960, getString(R.string.sc_k_camera), 0) }

        private fun sampleAlert(): LayerPainter.Alert = when (alertSample) {
            "t_super" -> LayerPainter.Alert(LayerPainter.AlertKind.SUPER, "Navid", "$5.00", getString(R.string.lay_sample_chat2))
            "t_member" -> LayerPainter.Alert(LayerPainter.AlertKind.MEMBER, "NightWolf", "Gold")
            "t_gift" -> LayerPainter.Alert(LayerPainter.AlertKind.GIFT, "Ali", "5")
            "t_cheer" -> LayerPainter.Alert(LayerPainter.AlertKind.CHEER, "Fan", "100 bits")
            "t_raid" -> LayerPainter.Alert(LayerPainter.AlertKind.RAID, "BigRaider", "55")
            "t_give" -> LayerPainter.Alert(LayerPainter.AlertKind.GIVEAWAY, "Sara_99", "17")
            "t_goal" -> LayerPainter.Alert(LayerPainter.AlertKind.GOAL, getString(R.string.sc_goal_default))
            else -> LayerPainter.Alert(LayerPainter.AlertKind.SUBSCRIBER, "Sara_99")
        }

        private fun videoThumb(file: String): Bitmap? {
            if (file.isBlank()) return null
            if (file in thumbs) return thumbs[file]
            thumbs[file] = null
            Thread {
                val b = try { MediaMetadataRetriever().run { setDataSource(file); val f = getFrameAtTime(0); release(); f } } catch (_: Exception) { null }
                ui.post { thumbs[file] = b; invalidate() }
            }.start()
            return null
        }

        /** Size on the picture (view pixels) of the layer's visible (cropped) part. */
        private fun sizeOf(l: Scenes.Layer, b: Bitmap, raw: Boolean = false): PointF {
            val (w, h) = Scenes.fit(b.width.toFloat(), b.height.toFloat(), 1080f * aspect)
            val c = if (raw) l.crop else Scenes.cropFor(l, w, h)
            return PointF(w * (c[2] - c[0]) * l.scale * k, h * (c[3] - c[1]) * l.scale * k)
        }

        private fun center(l: Scenes.Layer) = PointF(frame.left + l.x * frame.width(), frame.top + l.y * frame.height())

        /** Where layer [id]'s centre is on the view (tests). */
        internal fun pointOf(id: String): PointF? = scene().layers.firstOrNull { it.id == id }?.let { center(it) }

        /** Layer [id]'s visible size on the view (tests). */
        internal fun boxOf(id: String): PointF? = scene().layers.firstOrNull { it.id == id }?.let { l -> pic(l)?.let { sizeOf(l, it) } }

        override fun onDraw(c: Canvas) {
            val s = scene()
            // behind the layers: the game (the owner's last recording) or the scene's colour / picture
            if (s.game) {
                val bg = lastFrame
                if (bg != null) { c.save(); c.clipRect(frame); c.drawBitmap(bg, null, cover(bg, frame), paint); c.restore() }
                else { paint.shader = LinearGradient(frame.left, frame.top, frame.right, frame.bottom, Color.rgb(52, 74, 60), Color.rgb(120, 104, 74), Shader.TileMode.CLAMP); c.drawRect(frame, paint); paint.shader = null }
            } else {
                paint.color = s.bg; c.drawRect(frame, paint); paint.color = Color.BLACK
                LayerPainter.image(context, s.bgImage)?.let { img ->
                    val f = maxOf(frame.width() / img.width, frame.height() / img.height)
                    val w = img.width * f; val h = img.height * f
                    c.save(); c.clipRect(frame)
                    c.drawBitmap(img, null, RectF(frame.centerX() - w / 2, frame.centerY() - h / 2, frame.centerX() + w / 2, frame.centerY() + h / 2), paint)
                    c.restore()
                }
            }
            c.save(); c.clipRect(frame)
            for (l in s.layers) {
                val b = pic(l) ?: continue
                val sz = sizeOf(l, b)
                val ce = center(l)
                c.save()
                c.translate(ce.x, ce.y)
                c.rotate(l.rot)
                val dst = RectF(-sz.x / 2, -sz.y / 2, sz.x / 2, sz.y / 2)
                val cr = Scenes.cropFor(l, b.width.toFloat(), b.height.toFloat())
                val src = Rect((cr[0] * b.width).toInt(), (cr[1] * b.height).toInt(), (cr[2] * b.width).toInt(), (cr[3] * b.height).toInt())
                val corner = when (l.kind) {
                    Scenes.Kind.CAMERA -> when (l.int("mask", 1)) { 2 -> 99999f; 1 -> 36f; else -> 0f }
                    Scenes.Kind.IMAGE, Scenes.Kind.VIDEO -> l.num("radius", 0f)
                    else -> 0f
                } * l.scale * k
                if (corner > 0f) c.clipPath(Path().apply { addRoundRect(dst, minOf(corner, minOf(sz.x, sz.y) / 2), minOf(corner, minOf(sz.x, sz.y) / 2), Path.Direction.CW) })
                if (l.kind == Scenes.Kind.CAMERA && l.bool("mirror", true)) c.scale(-1f, 1f)
                paint.alpha = ((if (l.visible) 255 else 70) * l.alpha).toInt()
                c.drawBitmap(b, src, dst, paint)
                paint.alpha = 255
                c.restore()
            }
            c.restore()
            if (guideX) c.drawLine(frame.centerX(), frame.top, frame.centerX(), frame.bottom, guide)
            if (guideY) c.drawLine(frame.left, frame.centerY(), frame.right, frame.centerY(), guide)
            // the chosen layer: its box, the corner handle (size) and the round one (turn) — or the crop
            val l = layer()
            if (l != null) {
                val b = pic(l)
                if (b != null) {
                    val sz = sizeOf(l, b, raw = cropping)
                    val ce = center(l)
                    c.save(); c.translate(ce.x, ce.y); c.rotate(l.rot)
                    if (cropping) drawCrop(c, l, b, sz)
                    else {
                        c.drawRect(-sz.x / 2 - 4 * d, -sz.y / 2 - 4 * d, sz.x / 2 + 4 * d, sz.y / 2 + 4 * d, outline)
                        if (!l.locked) {
                            c.drawCircle(sz.x / 2 + 4 * d, sz.y / 2 + 4 * d, 9 * d, handle); c.drawCircle(sz.x / 2 + 4 * d, sz.y / 2 + 4 * d, 9 * d, handleRing)
                            c.drawLine(0f, -sz.y / 2 - 4 * d, 0f, -sz.y / 2 - 30 * d, outline)
                            c.drawCircle(0f, -sz.y / 2 - 30 * d, 9 * d, handle); c.drawCircle(0f, -sz.y / 2 - 30 * d, 9 * d, handleRing)
                        }
                    }
                    c.restore()
                }
            } else c.drawText(getString(R.string.sc_hint), frame.centerX(),
                if (height - frame.bottom > 26 * d) frame.bottom + 20 * d else frame.bottom - 14 * d, hint)
        }

        /** Crop mode: the whole source dimmed, the kept part clear, a handle on each of its edges. */
        private fun drawCrop(c: Canvas, l: Scenes.Layer, b: Bitmap, sz: PointF) {
            val cr = l.crop
            val fw = sz.x / (cr[2] - cr[0]); val fh = sz.y / (cr[3] - cr[1])
            // the full source, placed so the kept part stays where it is
            val left = -sz.x / 2 - cr[0] * fw; val top = -sz.y / 2 - cr[1] * fh
            val full = RectF(left, top, left + fw, top + fh)
            paint.alpha = 255
            c.drawBitmap(b, null, full, paint)
            val keep = RectF(-sz.x / 2, -sz.y / 2, sz.x / 2, sz.y / 2)
            c.drawRect(full.left, full.top, full.right, keep.top, dim); c.drawRect(full.left, keep.bottom, full.right, full.bottom, dim)
            c.drawRect(full.left, keep.top, keep.left, keep.bottom, dim); c.drawRect(keep.right, keep.top, full.right, keep.bottom, dim)
            c.drawRect(keep, outline)
            for (p in cropHandles(keep)) { c.drawCircle(p.x, p.y, 9 * d, handle); c.drawCircle(p.x, p.y, 9 * d, handleRing) }
        }

        private fun cropHandles(r: RectF) = listOf(PointF(r.left, r.centerY()), PointF(r.centerX(), r.top), PointF(r.right, r.centerY()), PointF(r.centerX(), r.bottom))

        /** A point on the view in the layer's own turned coordinates (0,0 = its centre). */
        private fun local(l: Scenes.Layer, x: Float, y: Float): PointF {
            val ce = center(l)
            val m = Matrix(); m.setRotate(-l.rot)
            val p = floatArrayOf(x - ce.x, y - ce.y)
            m.mapPoints(p)
            return PointF(p[0], p[1])
        }

        private fun hit(l: Scenes.Layer, x: Float, y: Float): Boolean {
            val b = pic(l) ?: return false
            val sz = sizeOf(l, b)
            val p = local(l, x, y)
            return abs(p.x) <= sz.x / 2 + 6 * d && abs(p.y) <= sz.y / 2 + 6 * d
        }

        // ---- gestures
        private var mode = 0          // 0 none, 1 move, 2 size, 3 turn, 4 two fingers, 5 crop edge
        private var startX = 0f
        private var startY = 0f
        private var startLx = 0f
        private var startLy = 0f
        private var startScale = 1f
        private var startRot = 0f
        private var startDist = 1f
        private var startAng = 0f
        private var cropEdge = -1
        private var moved = false

        @SuppressLint("ClickableViewAccessibility")
        override fun onTouchEvent(e: MotionEvent): Boolean {
            val l = layer()
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = e.x; startY = e.y; moved = false; mode = 0
                    if (l != null && !l.locked) {
                        val b = pic(l)
                        if (b != null) {
                            val sz = sizeOf(l, b, raw = cropping)
                            val p = local(l, e.x, e.y)
                            if (cropping) {
                                val keep = RectF(-sz.x / 2, -sz.y / 2, sz.x / 2, sz.y / 2)
                                cropEdge = cropHandles(keep).indexOfFirst { hypot(it.x - p.x, it.y - p.y) < 24 * d }
                                if (cropEdge >= 0) { snapshot(); mode = 5; startLx = l.x; startLy = l.y; return true }
                            } else if (hypot(p.x - (sz.x / 2 + 4 * d), p.y - (sz.y / 2 + 4 * d)) < 24 * d) {
                                snapshot(); mode = 2; startScale = l.scale; startDist = hypot(e.x - center(l).x, e.y - center(l).y).coerceAtLeast(1f); return true
                            } else if (hypot(p.x, p.y - (-sz.y / 2 - 30 * d)) < 24 * d) {
                                snapshot(); mode = 3; startRot = l.rot; startAng = Math.toDegrees(atan2((e.y - center(l).y).toDouble(), (e.x - center(l).x).toDouble())).toFloat(); return true
                            }
                        }
                    }
                    // a layer under the finger (front first) becomes the chosen one
                    val under = scene().layers.reversed().firstOrNull { hit(it, e.x, e.y) }
                    if (under != null) {
                        if (under.id != sel) { cropping = false; select(under.id) }
                        if (!under.locked) { snapshot(); mode = 1; startLx = under.x; startLy = under.y }
                    }
                }
                MotionEvent.ACTION_POINTER_DOWN -> if (l != null && !l.locked && e.pointerCount == 2) {
                    if (mode != 1) snapshot()
                    mode = 4
                    startScale = l.scale; startRot = l.rot
                    startDist = hypot(e.getX(1) - e.getX(0), e.getY(1) - e.getY(0)).coerceAtLeast(1f)
                    startAng = Math.toDegrees(atan2((e.getY(1) - e.getY(0)).toDouble(), (e.getX(1) - e.getX(0)).toDouble())).toFloat()
                }
                MotionEvent.ACTION_MOVE -> {
                    val cur = layer() ?: return true
                    if (abs(e.x - startX) > 4 * d || abs(e.y - startY) > 4 * d) moved = true
                    when (mode) {
                        1 -> if (moved) {
                            var nx = startLx + (e.x - startX) / frame.width()
                            var ny = startLy + (e.y - startY) / frame.height()
                            guideX = abs(nx - 0.5f) * frame.width() < 8 * d; guideY = abs(ny - 0.5f) * frame.height() < 8 * d
                            if (guideX) nx = 0.5f
                            if (guideY) ny = 0.5f
                            cur.x = nx.coerceIn(-0.2f, 1.2f); cur.y = ny.coerceIn(-0.2f, 1.2f)
                            changed(false)
                        }
                        2 -> { val dd = hypot(e.x - center(cur).x, e.y - center(cur).y); cur.scale = (startScale * dd / startDist).coerceIn(0.05f, 8f); changed(false) }
                        3 -> {
                            var a = startRot + Math.toDegrees(atan2((e.y - center(cur).y).toDouble(), (e.x - center(cur).x).toDouble())).toFloat() - startAng
                            a = norm(a); cur.rot = snapAngle(a); changed(false)
                        }
                        4 -> if (e.pointerCount >= 2) {
                            val dd = hypot(e.getX(1) - e.getX(0), e.getY(1) - e.getY(0))
                            val a = Math.toDegrees(atan2((e.getY(1) - e.getY(0)).toDouble(), (e.getX(1) - e.getX(0)).toDouble())).toFloat()
                            cur.scale = (startScale * dd / startDist).coerceIn(0.05f, 8f)
                            cur.rot = snapAngle(norm(startRot + a - startAng))
                            changed(false)
                        }
                        5 -> dragCrop(cur, e.x, e.y)
                    }
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    guideX = false; guideY = false
                    if (mode == 0 && !moved && e.actionMasked == MotionEvent.ACTION_UP && scene().layers.none { hit(it, e.x, e.y) }) { cropping = false; select(null, toProps = false) }
                    if (mode != 0) changed(structure = mode != 1 || moved)
                    mode = 0
                    invalidate()
                }
            }
            return true
        }

        private fun norm(a: Float): Float { var v = a; while (v > 180f) v -= 360f; while (v < -180f) v += 360f; return v }
        private fun snapAngle(a: Float) = listOf(-180f, -90f, 0f, 90f, 180f).firstOrNull { abs(it - a) < 4f } ?: a

        /** Moves one edge of the crop; the rest of the picture stays where it is. */
        private fun dragCrop(l: Scenes.Layer, x: Float, y: Float) {
            val b = pic(l) ?: return
            val cr = l.crop
            val sz = sizeOf(l, b, raw = true)
            val fw = sz.x / (cr[2] - cr[0]); val fh = sz.y / (cr[3] - cr[1])
            val p = local(l, x, y)
            // in source fractions, measured from the full source's top-left
            val left = -sz.x / 2 - cr[0] * fw; val top = -sz.y / 2 - cr[1] * fh
            val fx = ((p.x - left) / fw).coerceIn(0f, 1f); val fy = ((p.y - top) / fh).coerceIn(0f, 1f)
            val n = cr.copyOf()
            when (cropEdge) { 0 -> n[0] = fx.coerceAtMost(n[2] - 0.05f); 1 -> n[1] = fy.coerceAtMost(n[3] - 0.05f); 2 -> n[2] = fx.coerceAtLeast(n[0] + 0.05f); 3 -> n[3] = fy.coerceAtLeast(n[1] + 0.05f) }
            // keep the full source where it was: the kept part's centre moves with the edge
            val oldC = PointF(left + (cr[0] + cr[2]) / 2 * fw, top + (cr[1] + cr[3]) / 2 * fh)
            val newC = PointF(left + (n[0] + n[2]) / 2 * fw, top + (n[1] + n[3]) / 2 * fh)
            val m = Matrix(); m.setRotate(l.rot)
            val dv = floatArrayOf(newC.x - oldC.x, newC.y - oldC.y); m.mapVectors(dv)
            l.crop = n
            l.x += dv[0] / frame.width(); l.y += dv[1] / frame.height()
            changed(false)
        }

        @Suppress("unused") private fun unusedCos() = cos(0.0) + sin(0.0)
    }

    companion object {
        private const val REQ_PICK = 21
        private const val REQ_CAM = 22

        /**
         * The scene ([scene], else the active one) as viewers see it, [w] pixels wide: for the «زنده» page with sample
         * numbers, or with real [data] and [alert] (tests draw the stream this way). The game is [lastFrame].
         */
        fun preview(ctx: Context, w: Int, lastFrame: Bitmap?, scene: Scenes.Scene? = null, data: LayerPainter.Data? = null, alert: LayerPainter.Alert? = null): Bitmap {
            val a = Scenes.aspect(ctx)
            val h = (w / a).toInt().coerceAtLeast(1)
            val out = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(out)
            val p = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
            val all = RectF(0f, 0f, w.toFloat(), h.toFloat())
            val s = scene ?: Scenes.load(ctx).startScene
            if (!s.game) { c.drawColor(s.bg); LayerPainter.image(ctx, s.bgImage)?.let { c.drawBitmap(it, null, cover(it, all), p) } }
            else if (lastFrame != null) c.drawBitmap(lastFrame, null, cover(lastFrame, all), p)
            else { p.shader = LinearGradient(0f, 0f, w.toFloat(), h.toFloat(), Color.rgb(52, 74, 60), Color.rgb(120, 104, 74), Shader.TileMode.CLAMP); c.drawRect(all, p); p.shader = null }
            val sample = data == null
            val d = data ?: LayerPainter.Data().apply { subs = 12_345; viewers = 1_234; likes = 890; startedAt = System.currentTimeMillis() - 3_725_000 }
            val k = h / 1080f
            for (l in s.layers) {
                if (!l.visible) continue
                val b = when (l.kind) {
                    Scenes.Kind.TEXT, Scenes.Kind.SHAPE, Scenes.Kind.CHAT, Scenes.Kind.GOAL, Scenes.Kind.ALERTS, Scenes.Kind.IMAGE -> LayerPainter.paint(ctx, l, d, alert, sample)
                    else -> LayerPainter.placeholder(ctx, 1280, if (l.kind == Scenes.Kind.CAMERA) 960 else 720, ctx.getString(Scenes.kindName(l.kind)), 0)
                } ?: continue
                val (bw, bh) = Scenes.fit(b.width.toFloat(), b.height.toFloat(), 1080f * a)
                val cr = Scenes.cropFor(l, bw, bh)
                val sw = bw * (cr[2] - cr[0]) * l.scale * k; val sh = bh * (cr[3] - cr[1]) * l.scale * k
                c.save(); c.translate(l.x * w, l.y * h); c.rotate(l.rot)
                val corner = when (l.kind) {
                    Scenes.Kind.CAMERA -> when (l.int("mask", 1)) { 2 -> 99999f; 1 -> 36f; else -> 0f }
                    Scenes.Kind.IMAGE, Scenes.Kind.VIDEO -> l.num("radius", 0f)
                    else -> 0f
                } * l.scale * k
                if (corner > 0f) { val r = minOf(corner, minOf(sw, sh) / 2); c.clipPath(Path().apply { addRoundRect(RectF(-sw / 2, -sh / 2, sw / 2, sh / 2), r, r, Path.Direction.CW) }) }
                p.alpha = (255 * l.alpha).toInt()
                c.drawBitmap(b, Rect((cr[0] * b.width).toInt(), (cr[1] * b.height).toInt(), (cr[2] * b.width).toInt(), (cr[3] * b.height).toInt()), RectF(-sw / 2, -sh / 2, sw / 2, sh / 2), p)
                p.alpha = 255
                c.restore()
            }
            return out
        }

        /** Where [b] goes to fill [r] completely, keeping its shape (the rest is cut off). */
        fun cover(b: Bitmap, r: RectF): RectF {
            val f = maxOf(r.width() / b.width, r.height() / b.height)
            val w = b.width * f; val h = b.height * f
            return RectF(r.centerX() - w / 2, r.centerY() - h / 2, r.centerX() + w / 2, r.centerY() + h / 2)
        }

        /** The last recording's picture, or null (call off the main thread). */
        fun lastFrame(ctx: Context): Bitmap? = try {
            VideoLibrary.query(ctx).firstOrNull()?.let { ctx.contentResolver.loadThumbnail(it.uri, Size(1280, 720), null) }
        } catch (_: Exception) { null }
    }
}
