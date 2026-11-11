package com.vil3ntec.rawrec.desktop.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.vil3ntec.rawrec.desktop.studio.*
import java.awt.FileDialog
import java.awt.Frame

fun kindLabel(k: SourceKind) = when (k) {
    SourceKind.PHONE -> "گوشی"; SourceKind.WEBCAM -> "وب‌کم"; SourceKind.VIDEO -> "فایلِ ویدیو"; SourceKind.IMAGE -> "عکس"
    SourceKind.SCREEN -> "صفحهٔ کامپیوتر / پنجره"; SourceKind.SLIDESHOW -> "اسلایدشو"; SourceKind.COUNTER -> "شمارندهٔ بیننده/مشترک"; SourceKind.GOAL -> "نوارِ هدف"
    SourceKind.TEXT -> "متن"; SourceKind.COLOR -> "رنگ / پس‌زمینه"; SourceKind.CHAT -> "چت"; SourceKind.ALERTS -> "سوپرچت و هدیه"
    SourceKind.BROWSER -> "صفحهٔ وب / ویجت"
}

private fun kindMark(k: SourceKind) = when (k) {
    SourceKind.PHONE -> "▯"; SourceKind.WEBCAM -> "◉"; SourceKind.VIDEO -> "▶"; SourceKind.IMAGE -> "▣"
    SourceKind.SCREEN -> "▭"; SourceKind.SLIDESHOW -> "◫"; SourceKind.COUNTER -> "#"; SourceKind.GOAL -> "▰"
    SourceKind.TEXT -> "T"; SourceKind.COLOR -> "■"; SourceKind.CHAT -> "☰"; SourceKind.ALERTS -> "★"
    SourceKind.BROWSER -> "◎"
}

fun pickFolder(title: String): String? {
    val c = javax.swing.JFileChooser().apply { dialogTitle = title; fileSelectionMode = javax.swing.JFileChooser.DIRECTORIES_ONLY }
    return if (c.showOpenDialog(null) == javax.swing.JFileChooser.APPROVE_OPTION) c.selectedFile.absolutePath else null
}

fun saveFile(title: String, name: String): String? {
    val d = FileDialog(null as Frame?, title, FileDialog.SAVE); d.file = name; d.isVisible = true
    return d.file?.let { java.io.File(d.directory, it).absolutePath }
}

fun pickFile(title: String, exts: List<String>): String? {
    val d = FileDialog(null as Frame?, title, FileDialog.LOAD)
    d.setFilenameFilter { _, n -> exts.any { n.lowercase().endsWith(it) } }
    d.isVisible = true
    return d.file?.let { java.io.File(d.directory, it).absolutePath }
}

@Composable
fun ScenesPanel(studio: Studio, onEdit: (Studio) -> Unit, locked: Boolean) {
    val studioMode = studio.preview != null
    var renaming by remember { mutableStateOf<String?>(null) }
    Section("صحنه‌ها", trailing = {
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            Btn("+ عمودی ۹:۱۶", { onEdit(studio.addVerticalScene("عمودی (شورت)")) }, height = 24.dp)
            Btn("+ صحنه", { onEdit(studio.addScene("صحنهٔ ${studio.scenes.size + 1}", studio.editing)) }, height = 24.dp)
        }
    }) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for ((idx, s) in studio.scenes.withIndex()) {
                val cur = s.id == studio.editing.id
                val air = (studioMode && s.id == studio.current) || (s.vertical && s.id == studio.vertical)
                Row(Modifier.fillMaxWidth().height(32.dp).clip(RoundedCornerShape(6.dp))
                    .background(if (cur) K.AccentDim else K.Raised).border(1.dp, if (cur) K.Accent else K.Line, RoundedCornerShape(6.dp))
                    .clickable { onEdit(studio.open(s.id)) }.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (renaming == s.id) {
                        var name by remember(s.id) { mutableStateOf(s.name) }
                        Field(name, { name = it; onEdit(studio.copy(scenes = studio.scenes.map { x -> if (x.id == s.id) x.copy(name = it) else x })) }, Modifier.weight(1f))
                        Btn("✓", { renaming = null }, height = 24.dp)
                    } else {
                        if (idx < 9) T("${idx + 1}", 11, K.Faint, modifier = Modifier.width(14.dp))
                        T(s.name, 13, if (cur) K.Accent else K.Text, bold = cur, modifier = Modifier.weight(1f), maxLines = 1)
                        // a vertical scene: one small mark, red while it is the one on the upright output
                        if (s.vertical) { Pill("۹:۱۶", if (air) K.Live else K.Accent, if (air) K.Live else K.Accent); Spacer(Modifier.width(6.dp)) }
                        else if (air) { Pill("روی آنتن", K.Live, K.Live); Spacer(Modifier.width(6.dp)) }
                        T("${s.layers.size} لایه", 11, K.Faint)
                        Spacer(Modifier.width(6.dp))
                        T("✎", 13, K.Dim, modifier = Modifier.clickable { renaming = s.id })
                        if (studio.scenes.count { !it.vertical } > 1 || s.vertical) {
                            Spacer(Modifier.width(8.dp))
                            T("✕", 12, K.Dim, modifier = Modifier.clickable {
                                val rest = studio.scenes.filter { it.id != s.id }
                                val firstMain = rest.first { !it.vertical }.id
                                onEdit(studio.copy(scenes = rest, current = if (s.id == studio.current) firstMain else studio.current,
                                    preview = studio.preview?.let { p -> if (p == s.id) firstMain else p },
                                    vertical = studio.vertical?.takeIf { it != s.id } ?: rest.firstOrNull { it.vertical }?.id,
                                    focus = studio.focus?.takeIf { it != s.id }))
                            })
                        }
                    }
                }
            }
        }
        if (locked) T("حینِ ضبط یا پخش اندازهٔ تصویر ثابت می‌ماند؛ صحنه و لایه‌ها را آزادانه عوض کن.", 11, K.Faint, modifier = Modifier.padding(top = 6.dp))
        Spacer(Modifier.height(8.dp))
        T("گذار بینِ صحنه‌ها", 11, K.Dim)
        Spacer(Modifier.height(4.dp))
        Seg(listOf(Transition.CUT to "بُرش", Transition.FADE to "محو", Transition.SLIDE to "کشویی", Transition.ZOOM to "زوم"), studio.transition, { onEdit(studio.copy(transition = it)) })
        if (studio.transition != Transition.CUT) SliderRow("مدت", studio.transitionMs.toFloat(), 100f..2000f, "${studio.transitionMs} ms") { onEdit(studio.copy(transitionMs = (it / 50).toInt() * 50)) }
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Btn("ذخیرهٔ صحنه‌ها…", {
                saveFile("ذخیرهٔ مجموعهٔ صحنه‌ها", "RawRec scenes.json")?.let { java.io.File(it).writeText(Studio.toJson(studio)) }
            }, Modifier.weight(1f), height = 26.dp)
            Btn("باز کردن…", {
                pickFile("مجموعهٔ صحنه‌ها", listOf(".json"))?.let { f -> runCatching { Studio.fromJson(java.io.File(f).readText()) }.getOrNull()?.let(onEdit) }
            }, Modifier.weight(1f), height = 26.dp)
        }
    }
}

@Composable
fun LayersPanel(studio: Studio, selected: String?, onSelect: (String?) -> Unit, onEdit: (Studio) -> Unit, webcams: () -> List<String>) {
    var adding by remember { mutableStateOf(false) }
    Section("لایه‌ها — بالایی روی بقیه", trailing = { Btn(if (adding) "بستن" else "+ افزودن", { adding = !adding }, on = adding, height = 24.dp) }) {
        if (adding) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(K.Bg).border(1.dp, K.Line, RoundedCornerShape(8.dp)).padding(6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)) {
                fun add(k: SourceKind, props: Map<String, String> = emptyMap(), name: String = kindLabel(k)) {
                    val (s, l) = studio.add(k, name, props); onEdit(s); onSelect(l.id); adding = false
                }
                for (k in SourceKind.entries) {
                    if (k == SourceKind.PHONE && studio.sources.any { it.kind == SourceKind.PHONE }) {
                        // the one phone again (another scene, or after a delete)
                        if (studio.editing.layers.none { studio.source(it.sourceId)?.kind == SourceKind.PHONE }) {
                            Row(Modifier.fillMaxWidth().clickable {
                                val src = studio.sources.first { it.kind == SourceKind.PHONE }
                                val (cw, ch) = studio.canvasOf(studio.editing)
                                val l = Layer(Studio.newId(), src.id, 0f, 0f, cw.toFloat(), ch.toFloat())
                                onEdit(studio.withScene(studio.editing.copy(layers = listOf(l) + studio.editing.layers))); onSelect(l.id); adding = false
                            }.padding(6.dp)) { T("${kindMark(k)}   ${kindLabel(k)}") }
                        }
                        continue
                    }
                    Row(Modifier.fillMaxWidth().clickable {
                        when (k) {
                            SourceKind.IMAGE -> pickFile("یک عکس", listOf(".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"))?.let { add(k, mapOf("path" to it), java.io.File(it).name) }
                            SourceKind.VIDEO -> pickFile("یک ویدیو", listOf(".mp4", ".mov", ".mkv", ".webm", ".avi"))?.let { add(k, mapOf("path" to it), java.io.File(it).name) }
                            SourceKind.WEBCAM -> add(k, mapOf("device" to (webcams().firstOrNull() ?: "")))
                            SourceKind.TEXT -> add(k, mapOf("text" to "متنِ من", "size" to "64", "color" to "#FFFFFF"))
                            SourceKind.COLOR -> add(k, mapOf("color" to "#0F172A", "color2" to "#1E3A5F"))
                            SourceKind.CHAT -> add(k, mapOf("size" to "30", "fade" to "0"))
                            SourceKind.ALERTS -> add(k, mapOf("hold" to "7"))
                            SourceKind.PHONE -> add(k)
                            SourceKind.SCREEN -> add(k, mapOf("display" to "", "window" to ""))
                            SourceKind.SLIDESHOW -> pickFolder("پوشهٔ عکس‌ها")?.let { add(k, mapOf("folder" to it, "every" to "5", "fit" to "cover"), java.io.File(it).name) }
                            SourceKind.COUNTER -> add(k, mapOf("platform" to "ALL", "metric" to "VIEWERS"))
                            SourceKind.GOAL -> add(k, mapOf("platform" to "ALL", "metric" to "SUBSCRIBERS", "target" to "100", "start" to "0"))
                            SourceKind.BROWSER -> add(k, mapOf("url" to "", "w" to "800", "h" to "600", "fps" to "30"))
                        }
                    }.padding(6.dp)) { T("${kindMark(k)}   ${kindLabel(k)}") }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
        val layers = studio.editing.layers.asReversed()
        if (layers.isEmpty()) T("این صحنه خالی است. «+ افزودن» را بزن.", 12, K.Faint)
        LazyColumn(Modifier.fillMaxWidth().heightIn(max = 420.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            items(layers, key = { it.id }) { l ->
                val src = studio.source(l.sourceId)
                val sel = l.id == selected
                Row(Modifier.fillMaxWidth().height(34.dp).clip(RoundedCornerShape(6.dp))
                    .background(if (sel) K.Hover else K.Raised).border(1.dp, if (sel) K.Accent else K.Line, RoundedCornerShape(6.dp))
                    .clickable { onSelect(l.id) }.padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    T(src?.kind?.let(::kindMark) ?: "?", 13, if (sel) K.Accent else K.Dim, modifier = Modifier.width(18.dp))
                    T(src?.name ?: "—", 13, if (l.visible) K.Text else K.Faint, modifier = Modifier.weight(1f), maxLines = 1)
                    IconTxt(if (l.visible) "◐" else "○", if (l.visible) K.Text else K.Faint) { onEdit(studio.withLayer(l.copy(visible = !l.visible))) }
                    IconTxt(if (l.locked) "🔒" else "🔓", if (l.locked) K.Amber else K.Faint) { onEdit(studio.withLayer(l.copy(locked = !l.locked))) }
                    IconTxt("▲", K.Dim) { onEdit(studio.reorder(l.id, up = true)) }
                    IconTxt("▼", K.Dim) { onEdit(studio.reorder(l.id, up = false)) }
                    IconTxt("✕", K.Dim) { onEdit(studio.removeLayer(l.id)); if (sel) onSelect(null) }
                }
            }
        }
    }
}

@Composable
private fun IconTxt(t: String, c: Color, onClick: () -> Unit) {
    Box(Modifier.size(24.dp).clip(RoundedCornerShape(4.dp)).clickable { onClick() }, contentAlignment = Alignment.Center) { T(t, 12, c) }
}

/** The chosen layer: where, how big, how it looks, and its source's own settings. */
@Composable
fun Inspector(app: StudioApp, studio: Studio, selected: String?, onEdit: (Studio) -> Unit, webcams: () -> List<String>) {
    val l = studio.editing.layers.firstOrNull { it.id == selected }
    if (l == null) {
        Section("ویژگی‌ها") { T("یک لایه را در پیش‌نمایش یا فهرستِ لایه‌ها انتخاب کن.", 12, K.Faint) }
        return
    }
    val src = studio.source(l.sourceId) ?: return
    fun set(n: Layer) = onEdit(studio.withLayer(n))
    fun setSrc(n: SourceDef) = onEdit(studio.withSource(n))
    Section("${kindLabel(src.kind)} — جا و اندازه") {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            NumBox("X", l.x, Modifier.weight(1f)) { set(l.copy(x = it)) }
            NumBox("Y", l.y, Modifier.weight(1f)) { set(l.copy(y = it)) }
        }
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            NumBox("پهنا", l.w, Modifier.weight(1f)) { set(l.copy(w = it.coerceAtLeast(16f))) }
            NumBox("بلندی", l.h, Modifier.weight(1f)) { set(l.copy(h = it.coerceAtLeast(16f))) }
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            val (cw, ch) = studio.canvasOf(studio.editing)
            Btn("تمامِ تصویر", { set(l.copy(x = 0f, y = 0f, w = cw.toFloat(), h = ch.toFloat(), rot = 0f)) }, Modifier.weight(1f))
            Btn("وسط", { set(l.copy(x = (cw - l.w) / 2, y = (ch - l.h) / 2)) }, Modifier.weight(1f))
            Btn("تکثیر", { studio.duplicate(l.id)?.let { (s2, _) -> onEdit(s2) } }, Modifier.weight(1f))
        }
        Spacer(Modifier.height(6.dp))
        // alignment to the canvas edges (as OBS's «Transform → Align»)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            val W = studio.canvasOf(studio.editing).first.toFloat(); val H = studio.canvasOf(studio.editing).second.toFloat()
            Btn("⇥ راست", { set(l.copy(x = W - l.w)) }, Modifier.weight(1f), height = 26.dp)
            Btn("↔ وسط", { set(l.copy(x = (W - l.w) / 2)) }, Modifier.weight(1f), height = 26.dp)
            Btn("⇤ چپ", { set(l.copy(x = 0f)) }, Modifier.weight(1f), height = 26.dp)
            Btn("⤒ بالا", { set(l.copy(y = 0f)) }, Modifier.weight(1f), height = 26.dp)
            Btn("↕ وسط", { set(l.copy(y = (H - l.h) / 2)) }, Modifier.weight(1f), height = 26.dp)
            Btn("⤓ پایین", { set(l.copy(y = H - l.h)) }, Modifier.weight(1f), height = 26.dp)
        }
        Spacer(Modifier.height(8.dp))
        SliderRow("شفافیت", l.opacity, 0f..1f, "${(l.opacity * 100).toInt()}٪") { set(l.copy(opacity = it)) }
        SliderRow("گوشه", l.radius, 0f..120f, "${l.radius.toInt()}") { set(l.copy(radius = it)) }
        SliderRow("چرخش", l.rot, -180f..180f, "${l.rot.toInt()}°") { set(l.copy(rot = if (kotlin.math.abs(it) < 2f) 0f else it)) }
        if (src.kind in setOf(SourceKind.PHONE, SourceKind.WEBCAM, SourceKind.VIDEO, SourceKind.IMAGE, SourceKind.SCREEN)) {
            Spacer(Modifier.height(6.dp))
            T("وقتی شکلِ تصویر با کادر فرق دارد (گوشی می‌چرخد):", 11, K.Dim)
            Spacer(Modifier.height(4.dp))
            Seg(listOf(Fit.CONTAIN to "کامل در کادر", Fit.COVER to "پر کردنِ کادر", Fit.STRETCH to "کشیده"), l.fit, { set(l.copy(fit = it)) })
            Spacer(Modifier.height(6.dp))
            T("بریدن از لبه‌ها", 11, K.Dim)
            SliderRow("بالا", l.crop.t, 0f..0.45f, "${(l.crop.t * 100).toInt()}٪") { set(l.copy(crop = l.crop.copy(t = it))) }
            SliderRow("پایین", l.crop.b, 0f..0.45f, "${(l.crop.b * 100).toInt()}٪") { set(l.copy(crop = l.crop.copy(b = it))) }
            SliderRow("راست", l.crop.r, 0f..0.45f, "${(l.crop.r * 100).toInt()}٪") { set(l.copy(crop = l.crop.copy(r = it))) }
            SliderRow("چپ", l.crop.l, 0f..0.45f, "${(l.crop.l * 100).toInt()}٪") { set(l.copy(crop = l.crop.copy(l = it))) }
        }
    }
    if (src.kind in setOf(SourceKind.PHONE, SourceKind.WEBCAM, SourceKind.VIDEO, SourceKind.IMAGE, SourceKind.SCREEN)) {
        HLine()
        FxSection(l.fx) { set(l.copy(fx = it)) }
    }
    HLine()
    Section("تنظیماتِ ${kindLabel(src.kind)}") {
        Row(verticalAlignment = Alignment.CenterVertically) {
            T("نام", 12, K.Dim, modifier = Modifier.width(64.dp))
            Field(src.name, { setSrc(src.copy(name = it)) }, Modifier.weight(1f))
        }
        Spacer(Modifier.height(6.dp))
        when (src.kind) {
            SourceKind.TEXT -> {
                Field(src.prop("text"), { setSrc(src.with("text", it)) }, Modifier.fillMaxWidth().heightIn(min = 60.dp), singleLine = false)
                Spacer(Modifier.height(6.dp))
                SliderRow("اندازه", src.prop("size", "64").toFloat(), 16f..220f, src.prop("size", "64")) { setSrc(src.with("size", it.toInt().toString())) }
                ColorRow("رنگ", src.prop("color", "#FFFFFF")) { setSrc(src.with("color", it)) }
                ColorRow("پس‌زمینه", src.prop("bg"), allowNone = true) { setSrc(src.with("bg", it)) }
                Spacer(Modifier.height(4.dp))
                Seg(listOf("start" to "راست", "center" to "وسط", "end" to "چپ"), src.prop("align", "center"), { setSrc(src.with("align", it)) })
            }
            SourceKind.COLOR -> {
                ColorRow("رنگ ۱", src.prop("color", "#0F172A")) { setSrc(src.with("color", it)) }
                ColorRow("رنگ ۲", src.prop("color2"), allowNone = true) { setSrc(src.with("color2", it)) }
            }
            SourceKind.WEBCAM -> {
                val list = remember { webcams() }
                if (list.isEmpty()) T("دوربینی پیدا نشد. وب‌کم را وصل کن و برنامه را دوباره باز کن.", 12, K.Warn)
                for (d in list) Btn(d, { setSrc(src.with("device", d)) }, Modifier.fillMaxWidth().padding(bottom = 4.dp), on = d == src.prop("device"))
                app.engine.sourceError(src.id)?.let { T("دوربین باز نشد: $it", 12, K.Live) }
            }
            SourceKind.IMAGE, SourceKind.VIDEO -> {
                T(src.prop("path"), 11, K.Dim, maxLines = 2)
                if (src.kind == SourceKind.VIDEO) Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    T("صدای خودِ فایل در میکسر", 12, modifier = Modifier.weight(1f))
                    Seg(listOf("1" to "باشد", "0" to "نباشد"), src.prop("audio", "1"), { setSrc(src.with("audio", it)) }, Modifier.width(130.dp))
                }
                Btn("انتخابِ فایلِ دیگر", {
                    pickFile("فایل", if (src.kind == SourceKind.IMAGE) listOf(".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp") else listOf(".mp4", ".mov", ".mkv", ".webm", ".avi"))
                        ?.let { setSrc(src.with("path", it).copy(name = java.io.File(it).name)) }
                }, Modifier.fillMaxWidth().padding(top = 4.dp))
            }
            SourceKind.CHAT -> {
                SliderRow("اندازه", src.prop("size", "30").toFloat(), 16f..64f, src.prop("size", "30")) { setSrc(src.with("size", it.toInt().toString())) }
                SliderRow("محو پس از", src.prop("fade", "0").toFloat(), 0f..120f, if (src.prop("fade", "0") == "0") "هرگز" else "${src.prop("fade")} ث") { setSrc(src.with("fade", it.toInt().toString())) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    T("متنِ اصلی زیرِ ترجمه", 12, K.Dim, modifier = Modifier.weight(1f))
                    Seg(listOf("1" to "باشد", "0" to "نباشد"), src.prop("original", "1"), { setSrc(src.with("original", it)) }, Modifier.width(140.dp))
                }
                Spacer(Modifier.height(6.dp))
                Btn("پیامِ آزمایشی", { ChatHub.add(ChatMessage(Studio.newId(), Platform.TEST, "RawRec", "سلام! این یک پیامِ آزمایشی است 👋")) }, Modifier.fillMaxWidth())
            }
            SourceKind.ALERTS -> {
                SliderRow("ماندن", src.prop("hold", "7").toFloat(), 3f..20f, "${src.prop("hold", "7")} ث") { setSrc(src.with("hold", it.toInt().toString())) }
                Btn("سوپرچتِ آزمایشی", { ChatHub.add(ChatMessage(Studio.newId(), Platform.TEST, "بیننده", "عالی بود! ادامه بده 🔥", ChatMessage.Kind.SUPERCHAT, "$5.00")) }, Modifier.fillMaxWidth())
            }
            SourceKind.PHONE -> T("کیفیتِ گرفتن از گوشی در پنلِ «گوشی» است.", 12, K.Dim)
            SourceKind.SCREEN -> ScreenSettings(app, src) { setSrc(it) }
            SourceKind.BROWSER -> {
                T("نشانیِ ویجت (StreamElements، Streamlabs…) یا هر صفحه، یا یک فایلِ HTML روی همین کامپیوتر:", 11, K.Dim)
                Spacer(Modifier.height(4.dp))
                var u by remember(src.id) { mutableStateOf(src.prop("url")) }
                Field(u, { u = it }, Modifier.fillMaxWidth(), hint = "https://…", ltr = true)
                Row(Modifier.padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Btn("باز کن", { setSrc(src.with("url", u.trim())) }, Modifier.weight(1f), on = true, height = 28.dp)
                    Btn("فایلِ HTML…", { pickFile("صفحهٔ HTML", listOf(".html", ".htm"))?.let { u = it; setSrc(src.with("url", it)) } }, Modifier.weight(1f), height = 28.dp)
                    Btn("↻ از نو", { setSrc(src.with("reload", ((src.prop("reload", "0").toIntOrNull() ?: 0) + 1).toString())) }, Modifier.weight(1f), height = 28.dp)
                }
                Spacer(Modifier.height(6.dp))
                T("اندازهٔ صفحه (پیکسل) — همان که سازندهٔ ویجت گفته", 11, K.Dim)
                Seg(listOf("800x600" to "800×600", "1280x720" to "1280×720", "1920x1080" to "1920×1080"), "${src.prop("w", "800")}x${src.prop("h", "600")}", { v ->
                    val (w, h) = v.split('x'); setSrc(src.with("w", w).with("h", h))
                })
                Seg(listOf("30" to "۳۰ فریم", "60" to "۶۰ فریم"), src.prop("fps", "30"), { setSrc(src.with("fps", it)) })
                Spacer(Modifier.height(6.dp))
                T("CSSِ دلخواه (مثلِ OBS)", 11, K.Dim)
                var c by remember(src.id) { mutableStateOf(src.prop("css")) }
                Field(c, { c = it }, Modifier.fillMaxWidth().heightIn(min = 50.dp), ltr = true, singleLine = false)
                Btn("اعمالِ CSS", { setSrc(src.with("css", c)) }, Modifier.fillMaxWidth().padding(top = 4.dp), height = 26.dp)
                app.engine.sourceError(src.id)?.let { T(it, 12, K.Live) }
            }
            SourceKind.SLIDESHOW -> {
                T(src.prop("folder"), 11, K.Dim, maxLines = 2)
                Btn("پوشهٔ دیگر", { pickFolder("پوشهٔ عکس‌ها")?.let { setSrc(src.with("folder", it).copy(name = java.io.File(it).name)) } }, Modifier.fillMaxWidth().padding(vertical = 4.dp))
                SliderRow("هر عکس", src.prop("every", "5").toFloat(), 1f..60f, "${src.prop("every", "5")} ث") { setSrc(src.with("every", it.toInt().toString())) }
                Seg(listOf("cover" to "پر کردنِ کادر", "contain" to "کامل در کادر"), src.prop("fit", "cover"), { setSrc(src.with("fit", it)) })
            }
            SourceKind.COUNTER, SourceKind.GOAL -> {
                T("کانال‌ها از پنلِ «چت» خوانده می‌شوند (هر ۳۰ ثانیه، بی‌ورود و بی‌سهمیه).", 11, K.Faint)
                Spacer(Modifier.height(4.dp))
                Seg(listOf("VIEWERS" to "بیننده", "FOLLOWERS" to "دنبال‌کننده", "SUBSCRIBERS" to "مشترک"), src.prop("metric", "VIEWERS"), { setSrc(src.with("metric", it)) })
                Spacer(Modifier.height(4.dp))
                val plats = listOf("ALL" to "همه با هم", "YOUTUBE" to "YouTube", "TWITCH" to "Twitch", "KICK" to "Kick") + (if (src.kind == SourceKind.GOAL) listOf("MANUAL" to "دستی") else emptyList())
                Seg(plats, src.prop("platform", "ALL"), { setSrc(src.with("platform", it)) })
                Spacer(Modifier.height(4.dp))
                Field(src.prop("label"), { setSrc(src.with("label", it)) }, Modifier.fillMaxWidth(), hint = "نوشته (خالی = خودکار)")
                if (src.kind == SourceKind.GOAL) {
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Field(src.prop("target", "100"), { setSrc(src.with("target", it.filter(Char::isDigit))) }, Modifier.weight(1f), hint = "هدف", ltr = true)
                        Field(src.prop("start", "0"), { setSrc(src.with("start", it.filter(Char::isDigit))) }, Modifier.weight(1f), hint = "شروع از", ltr = true)
                        if (src.prop("platform") == "MANUAL") Field(src.prop("value", "0"), { setSrc(src.with("value", it.filter(Char::isDigit))) }, Modifier.weight(1f), hint = "الان", ltr = true)
                    }
                    T("«شروع از»: شمارِ امروزِ پیش از پخش، تا فقط تازه‌ها شمرده شوند.", 11, K.Faint)
                }
                PlatformStats.errors.forEach { (p, e) -> T("${p.label}: $e", 11, K.Warn) }
            }
        }
    }
}

@Composable
private fun NumBox(label: String, v: Float, modifier: Modifier, onSet: (Float) -> Unit) {
    var text by remember(v.toInt()) { mutableStateOf(v.toInt().toString()) }
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        T(label, 11, K.Dim, modifier = Modifier.width(36.dp))
        Field(text, { t -> text = t; t.toFloatOrNull()?.let(onSet) }, Modifier.weight(1f), ltr = true)
    }
}

private val swatches = listOf("#FFFFFF", "#000000", "#2DD4BF", "#F59E0B", "#EF4444", "#3B82F6", "#A855F7", "#22C55E", "#0F172A", "#80000000")

@Composable
fun ColorRow(label: String, value: String, allowNone: Boolean = false, onPick: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
        T(label, 12, K.Dim, modifier = Modifier.width(64.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), modifier = Modifier.weight(1f)) {
            if (allowNone) Box(Modifier.size(20.dp).clip(RoundedCornerShape(4.dp)).border(1.dp, if (value.isBlank()) K.Accent else K.Line, RoundedCornerShape(4.dp))
                .clickable { onPick("") }, contentAlignment = Alignment.Center) { T("∅", 11, K.Dim) }
            for (c in swatches) {
                val col = Color(com.vil3ntec.rawrec.desktop.studio.Fonts.color(c, -1))
                Box(Modifier.size(20.dp).clip(RoundedCornerShape(4.dp)).background(col)
                    .border(if (c.equals(value, true)) 2.dp else 1.dp, if (c.equals(value, true)) K.Accent else K.Line, RoundedCornerShape(4.dp)).clickable { onPick(c) })
            }
        }
    }
}

/** Green screen, colour and sharpness of a picture layer (OBS's «Chroma Key», «Color Correction», «Sharpen» filters, in one). */
@Composable
fun FxSection(fx: Fx, onFx: (Fx) -> Unit) {
    Section("جلوه‌ها", trailing = { if (fx.active) Btn("بی‌جلوه", { onFx(Fx()) }, height = 24.dp) }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            T("پردهٔ سبز (حذفِ رنگ)", 12, modifier = Modifier.weight(1f))
            Seg(listOf(true to "روشن", false to "خاموش"), fx.key, { onFx(fx.copy(key = it)) }, Modifier.width(130.dp))
        }
        if (fx.key) {
            Row(Modifier.padding(vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                for ((c, n) in listOf(0xFF00FF00.toInt() to "سبز", 0xFF0000FF.toInt() to "آبی", 0xFFFF00FF.toInt() to "سرخابی")) Btn(n, { onFx(fx.copy(keyColor = c)) }, Modifier.weight(1f), on = fx.keyColor == c, height = 26.dp)
            }
            SliderRow("شباهت", fx.similarity, 0.01f..1f, "${(fx.similarity * 1000).toInt()}") { onFx(fx.copy(similarity = it)) }
            SliderRow("نرمیِ لبه", fx.smoothness, 0.01f..0.5f, "${(fx.smoothness * 1000).toInt()}") { onFx(fx.copy(smoothness = it)) }
            SliderRow("رنگِ برگشتی", fx.spill, 0.01f..0.5f, "${(fx.spill * 1000).toInt()}") { onFx(fx.copy(spill = it)) }
        }
        Spacer(Modifier.height(6.dp))
        SliderRow("روشنی", fx.brightness, -0.5f..0.5f, "%+.2f".format(fx.brightness)) { onFx(fx.copy(brightness = if (kotlin.math.abs(it) < 0.01f) 0f else it)) }
        SliderRow("کنتراست", fx.contrast, 0.5f..2f, "%.2f".format(fx.contrast)) { onFx(fx.copy(contrast = if (kotlin.math.abs(it - 1) < 0.02f) 1f else it)) }
        SliderRow("اشباعِ رنگ", fx.saturation, 0f..2f, "%.2f".format(fx.saturation)) { onFx(fx.copy(saturation = if (kotlin.math.abs(it - 1) < 0.02f) 1f else it)) }
        SliderRow("گاما", fx.gamma, 0.5f..2f, "%.2f".format(fx.gamma)) { onFx(fx.copy(gamma = if (kotlin.math.abs(it - 1) < 0.02f) 1f else it)) }
        SliderRow("رنگ‌مایه", fx.hue, -180f..180f, "${fx.hue.toInt()}°") { onFx(fx.copy(hue = if (kotlin.math.abs(it) < 2f) 0f else it)) }
        SliderRow("تیزی", fx.sharpen, 0f..1f, "${(fx.sharpen * 100).toInt()}٪") { onFx(fx.copy(sharpen = if (it < 0.02f) 0f else it)) }
    }
}
