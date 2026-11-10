package com.vil3ntec.rawrec.desktop.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.*
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import com.vil3ntec.rawrec.desktop.AppPaths
import com.vil3ntec.rawrec.desktop.Encoders
import com.vil3ntec.rawrec.desktop.studio.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import java.io.File

private fun ms(t: Long) = "%d:%02d.%d".format(t / 60000, t / 1000 % 60, t / 100 % 10)

/**
 * Cutting and joining recordings, and the «studio» treatment (clean-up, Lanczos to 1440p/4K, CAS
 * sharpening), each change shown at once: the picture is split, before on one side and after on the
 * other, with a handle to move the split.
 */
@Composable
fun EditorScreen(encoders: List<Encoders.Encoder>?) {
    var files by remember { mutableStateOf(listOf<File>()) }
    var current by remember { mutableStateOf<File?>(null) }
    var info by remember { mutableStateOf<MediaInfo?>(null) }
    var pos by remember { mutableStateOf(0L) }
    var inMs by remember { mutableStateOf(0L) }
    var outMs by remember { mutableStateOf(0L) }
    val clips = remember { mutableStateListOf<Clip>() }
    var opt by remember { mutableStateOf(ExportOptions(height = 1440, enhance = true, sharpen = 0.9f)) }
    var previewError by remember { mutableStateOf<String?>(null) }
    var before by remember { mutableStateOf<ImageBitmap?>(null) }
    var after by remember { mutableStateOf<ImageBitmap?>(null) }
    var split by remember { mutableStateOf(0.5f) }
    var job by remember { mutableStateOf<Exporter?>(null) }
    var tick by remember { mutableStateOf(0) }
    var result by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(Unit) {
        while (true) {
            files = withContext(Dispatchers.IO) {
                AppPaths.videos.listFiles { f -> f.isFile && f.extension.lowercase() in setOf("mp4", "mkv", "mov") }?.sortedByDescending { it.lastModified() } ?: emptyList()
            }
            delay(3000)
        }
    }
    LaunchedEffect(current) {
        val f = current ?: return@LaunchedEffect
        info = try { withContext(Dispatchers.IO) { Media.info(f) } } catch (e: Exception) { null }
        pos = 0; inMs = 0; outMs = info?.durationMs ?: 0
    }
    // the picture under the playhead, before and after: again whenever the place or a setting changes
    LaunchedEffect(current, pos, opt) {
        val f = current ?: return@LaunchedEffect
        delay(120)
        try {
            val (b, a) = withContext(Dispatchers.IO) {
                Media.frameAt(f, pos, 1600)?.toComposeImageBitmap() to Media.frameAt(f, pos, 1600, opt)?.toComposeImageBitmap()
            }
            before = b; after = a; previewError = null
        } catch (e: Throwable) { if (e is kotlinx.coroutines.CancellationException) throw e; previewError = e.message ?: e.javaClass.simpleName }
    }
    LaunchedEffect(job) { while (job != null) { delay(250); tick++ } }

    Row(Modifier.fillMaxSize()) {
        // recordings
        Column(Modifier.width(300.dp).fillMaxHeight().background(K.Panel).verticalScroll(rememberScrollState())) {
            Section("ضبط‌ها") {
                if (files.isEmpty()) T("هنوز ضبطی نیست. از «استودیو» ضبط کن؛ این‌جا می‌آید.", 12, K.Faint)
                for (f in files) {
                    val on = f == current
                    Column(Modifier.fillMaxWidth().padding(bottom = 4.dp).clip(RoundedCornerShape(6.dp)).background(if (on) K.AccentDim else K.Raised)
                        .border(1.dp, if (on) K.Accent else K.Line, RoundedCornerShape(6.dp)).clickable { current = f }.padding(8.dp)) {
                        T(f.nameWithoutExtension, 12, if (on) K.Accent else K.Text, maxLines = 1)
                        T("${f.length() / 1_048_576} مگابایت", 11, K.Faint)
                    }
                }
            }
        }
        Box(Modifier.width(1.dp).fillMaxHeight().background(K.Line))
        // the picture, the playhead, in/out, the clips
        Column(Modifier.weight(1f).fillMaxHeight().padding(12.dp)) {
            var box by remember { mutableStateOf(IntSize.Zero) }
            Box(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Color(0xFF07090C)).border(1.dp, K.Line, RoundedCornerShape(8.dp))
                .onSizeChanged { box = it }
                .pointerInput(Unit) { detectDragGestures { ch, _ -> ch.consume(); split = (ch.position.x / box.width).coerceIn(0f, 1f) } }) {
                val b = before; val a = after
                if (b == null) T(if (current == null) "یک ضبط را از فهرست انتخاب کن." else previewError?.let { "پیش‌نمایش نشد: $it" } ?: "…", 13, if (previewError != null) K.Live else K.Dim, modifier = Modifier.align(Alignment.Center))
                Canvas(Modifier.fillMaxSize()) {
                    if (b == null) return@Canvas
                    val k = minOf(size.width / b.width, size.height / b.height)
                    val w = b.width * k; val h = b.height * k
                    val o = Offset((size.width - w) / 2, (size.height - h) / 2)
                    val cut = size.width * split
                    // before (left of the handle), after (right of it) — the same place, the same size on screen
                    clipRect(right = cut) { drawImage(b, dstOffset = IntOffset(o.x.toInt(), o.y.toInt()), dstSize = IntSize(w.toInt(), h.toInt()), filterQuality = FilterQuality.High) }
                    if (a != null) clipRect(left = cut) { drawImage(a, dstOffset = IntOffset(o.x.toInt(), o.y.toInt()), dstSize = IntSize(w.toInt(), h.toInt()), filterQuality = FilterQuality.High) }
                    drawLine(K.Accent, Offset(cut, 0f), Offset(cut, size.height), 2f)
                    drawCircle(K.Accent, 9f, Offset(cut, size.height / 2))
                }
                if (b != null) {
                    Box(Modifier.align(Alignment.TopStart).padding(10.dp)) { Pill("بعد: ${if (opt.enhance) "بهبود + " else ""}${opt.height.takeIf { it > 0 }?.let { "${it}p" } ?: "همان اندازه"}", K.Accent) }
                    Box(Modifier.align(Alignment.TopEnd).padding(10.dp)) { Pill("قبل: اصلی") }
                }
            }
            Spacer(Modifier.height(8.dp))
            val dur = info?.durationMs ?: 0
            Row(verticalAlignment = Alignment.CenterVertically) {
                T(ms(pos), 12, K.Text, modifier = Modifier.width(60.dp))
                Slider(pos.toFloat(), { pos = it.toLong() }, valueRange = 0f..maxOf(1f, dur.toFloat()), modifier = Modifier.weight(1f),
                    colors = SliderDefaults.colors(thumbColor = K.Accent, activeTrackColor = K.Accent, inactiveTrackColor = K.Line), enabled = current != null)
                T(ms(dur), 12, K.Dim, modifier = Modifier.width(60.dp))
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                Btn("شروع از این‌جا  [${ms(inMs)}]", { inMs = pos.coerceAtMost(outMs - 100) }, enabled = current != null)
                Btn("پایان تا این‌جا  [${ms(outMs)}]", { outMs = pos.coerceAtLeast(inMs + 100) }, enabled = current != null)
                Btn("+ افزودن به فیلم", { current?.let { clips.add(Clip(it, inMs, outMs)) } }, on = true, enabled = current != null && outMs > inMs)
                Spacer(Modifier.weight(1f))
                T("طول: ${ms((outMs - inMs).coerceAtLeast(0))}", 12, K.Dim)
            }
            Spacer(Modifier.height(8.dp))
            Section("فیلمِ نهایی — تکه‌ها به ترتیب") {
                if (clips.isEmpty()) T("تکه‌ای اضافه نشده: یک ضبط را انتخاب کن، شروع و پایان را بگذار، «افزودن به فیلم».", 12, K.Faint)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    clips.forEachIndexed { i, c ->
                        Column(Modifier.clip(RoundedCornerShape(6.dp)).background(K.Raised).border(1.dp, K.LineHi, RoundedCornerShape(6.dp)).padding(8.dp)) {
                            T("${i + 1}. ${c.file.nameWithoutExtension.takeLast(14)}", 12, maxLines = 1)
                            T("${ms(c.inMs)} → ${ms(c.outMs)}", 11, K.Dim)
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                T("◀", 12, K.Dim, modifier = Modifier.clickable { if (i > 0) { val x = clips.removeAt(i); clips.add(i - 1, x) } })
                                T("▶", 12, K.Dim, modifier = Modifier.clickable { if (i < clips.size - 1) { val x = clips.removeAt(i); clips.add(i + 1, x) } })
                                T("✕", 12, K.Live, modifier = Modifier.clickable { clips.removeAt(i) })
                            }
                        }
                    }
                }
            }
        }
        Box(Modifier.width(1.dp).fillMaxHeight().background(K.Line))
        // the treatment and the export
        Column(Modifier.width(340.dp).fillMaxHeight().background(K.Panel).verticalScroll(rememberScrollState())) {
            Section("بهبودِ کیفیت") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    T("پاک‌سازی + تیز کردن", 12, modifier = Modifier.weight(1f))
                    Seg(listOf(true to "روشن", false to "خاموش"), opt.enhance, { opt = opt.copy(enhance = it) }, Modifier.width(130.dp))
                }
                SliderRow("تیزی", opt.sharpen, 0f..0.95f, "${(opt.sharpen * 100).toInt()}٪") { opt = opt.copy(sharpen = it) }
                T("بلوک‌ها و نویزِ فشرده‌سازیِ گوشی کم می‌شود، بعد با Lanczos بزرگ و با CAS (مثلِ FidelityFX) تیز می‌شود. سنجیده‌شده (۱۴۴۰p): بلوک ۱۰٪ کمتر و تیزی ۹٪ بیشتر از بزرگ‌نماییِ معمولی.", 11, K.Faint)
                Spacer(Modifier.height(6.dp))
                T("اندازهٔ خروجی", 11, K.Dim)
                Seg(listOf(0 to "همان", 1080 to "1080p", 1440 to "1440p", 2160 to "4K"), opt.height, { opt = opt.copy(height = it) })
                T("برای یوتیوب 1440p یا 4K: یوتیوب به این‌ها کدکِ بهتر و بیت‌ریتِ خیلی بیشتری می‌دهد — بیشترین فرقِ دیده‌شده همین است.", 11, K.Accent, modifier = Modifier.padding(top = 4.dp))
            }
            HLine()
            Section("خروجی") {
                EncoderPick(encoders, opt.encoder, null, enabled = job == null) { opt = opt.copy(encoder = it) }
                Spacer(Modifier.height(8.dp))
                val j = job
                if (j == null) Btn("ساختنِ فیلم (${clips.size} تکه)", {
                    val e = Exporter(clips.toList(), opt)
                    job = e; result = null
                    Thread {
                        val f = e.run()
                        result = f?.let { "ساخته شد: ${it.name}" } ?: "نشد: ${e.error}"
                        job = null
                    }.start()
                }, Modifier.fillMaxWidth(), on = true, enabled = clips.isNotEmpty(), height = 38.dp, bold = true)
                else {
                    val p = remember(tick) { j.progress }
                    Box(Modifier.fillMaxWidth().height(10.dp).clip(RoundedCornerShape(5.dp)).background(K.Bg)) {
                        Box(Modifier.fillMaxWidth(p).fillMaxHeight().background(K.Accent))
                    }
                    T("${(p * 100).toInt()}٪", 12, K.Dim, modifier = Modifier.padding(top = 4.dp))
                    Btn("لغو", { j.cancel() }, Modifier.fillMaxWidth().padding(top = 4.dp))
                }
                result?.let { T(it, 12, if (it.startsWith("ساخته")) K.Good else K.Live, modifier = Modifier.padding(top = 6.dp)) }
                Btn("پوشهٔ فیلم‌ها", { runCatching { java.awt.Desktop.getDesktop().open(AppPaths.videos) } }, Modifier.fillMaxWidth().padding(top = 6.dp))
            }
        }
    }
}
