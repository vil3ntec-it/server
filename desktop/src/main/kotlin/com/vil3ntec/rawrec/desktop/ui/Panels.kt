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
    SourceKind.TEXT -> "متن"; SourceKind.COLOR -> "رنگ / پس‌زمینه"; SourceKind.CHAT -> "چت"; SourceKind.ALERTS -> "سوپرچت و هدیه"
}

private fun kindMark(k: SourceKind) = when (k) {
    SourceKind.PHONE -> "▯"; SourceKind.WEBCAM -> "◉"; SourceKind.VIDEO -> "▶"; SourceKind.IMAGE -> "▣"
    SourceKind.TEXT -> "T"; SourceKind.COLOR -> "■"; SourceKind.CHAT -> "☰"; SourceKind.ALERTS -> "★"
}

fun pickFile(title: String, exts: List<String>): String? {
    val d = FileDialog(null as Frame?, title, FileDialog.LOAD)
    d.setFilenameFilter { _, n -> exts.any { n.lowercase().endsWith(it) } }
    d.isVisible = true
    return d.file?.let { java.io.File(d.directory, it).absolutePath }
}

@Composable
fun ScenesPanel(studio: Studio, onEdit: (Studio) -> Unit, locked: Boolean) {
    var renaming by remember { mutableStateOf<String?>(null) }
    Section("صحنه‌ها", trailing = {
        Btn("+ صحنه", { onEdit(studio.addScene("صحنهٔ ${studio.scenes.size + 1}", studio.scene)) }, height = 24.dp)
    }) {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for (s in studio.scenes) {
                val cur = s.id == studio.current
                Row(Modifier.fillMaxWidth().height(32.dp).clip(RoundedCornerShape(6.dp))
                    .background(if (cur) K.AccentDim else K.Raised).border(1.dp, if (cur) K.Accent else K.Line, RoundedCornerShape(6.dp))
                    .clickable { onEdit(studio.copy(current = s.id)) }.padding(horizontal = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    if (renaming == s.id) {
                        var name by remember(s.id) { mutableStateOf(s.name) }
                        Field(name, { name = it; onEdit(studio.copy(scenes = studio.scenes.map { x -> if (x.id == s.id) x.copy(name = it) else x })) }, Modifier.weight(1f))
                        Btn("✓", { renaming = null }, height = 24.dp)
                    } else {
                        T(s.name, 13, if (cur) K.Accent else K.Text, bold = cur, modifier = Modifier.weight(1f), maxLines = 1)
                        T("${s.layers.size} لایه", 11, K.Faint)
                        Spacer(Modifier.width(6.dp))
                        T("✎", 13, K.Dim, modifier = Modifier.clickable { renaming = s.id })
                        if (studio.scenes.size > 1) {
                            Spacer(Modifier.width(8.dp))
                            T("✕", 12, K.Dim, modifier = Modifier.clickable {
                                val rest = studio.scenes.filter { it.id != s.id }
                                onEdit(studio.copy(scenes = rest, current = if (cur) rest.first().id else studio.current))
                            })
                        }
                    }
                }
            }
        }
        if (locked) T("حینِ ضبط یا پخش اندازهٔ تصویر ثابت می‌ماند؛ صحنه و لایه‌ها را آزادانه عوض کن.", 11, K.Faint, modifier = Modifier.padding(top = 6.dp))
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
                        if (studio.scene.layers.none { studio.source(it.sourceId)?.kind == SourceKind.PHONE }) {
                            Row(Modifier.fillMaxWidth().clickable {
                                val src = studio.sources.first { it.kind == SourceKind.PHONE }
                                val l = Layer(Studio.newId(), src.id, 0f, 0f, studio.width.toFloat(), studio.height.toFloat())
                                onEdit(studio.withScene(studio.scene.copy(layers = listOf(l) + studio.scene.layers))); onSelect(l.id); adding = false
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
                        }
                    }.padding(6.dp)) { T("${kindMark(k)}   ${kindLabel(k)}") }
                }
            }
            Spacer(Modifier.height(8.dp))
        }
        val layers = studio.scene.layers.asReversed()
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
    val l = studio.scene.layers.firstOrNull { it.id == selected }
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
            Btn("تمامِ تصویر", { set(l.copy(x = 0f, y = 0f, w = studio.width.toFloat(), h = studio.height.toFloat(), rot = 0f)) }, Modifier.weight(1f))
            Btn("وسط", { set(l.copy(x = (studio.width - l.w) / 2, y = (studio.height - l.h) / 2)) }, Modifier.weight(1f))
        }
        Spacer(Modifier.height(8.dp))
        SliderRow("شفافیت", l.opacity, 0f..1f, "${(l.opacity * 100).toInt()}٪") { set(l.copy(opacity = it)) }
        SliderRow("گوشه", l.radius, 0f..120f, "${l.radius.toInt()}") { set(l.copy(radius = it)) }
        SliderRow("چرخش", l.rot, -180f..180f, "${l.rot.toInt()}°") { set(l.copy(rot = if (kotlin.math.abs(it) < 2f) 0f else it)) }
        if (src.kind in setOf(SourceKind.PHONE, SourceKind.WEBCAM, SourceKind.VIDEO, SourceKind.IMAGE)) {
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
