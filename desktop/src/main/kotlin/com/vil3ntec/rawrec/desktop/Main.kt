package com.vil3ntec.rawrec.desktop

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asComposeImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.platform.Font
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import org.jetbrains.skia.Bitmap
import org.jetbrains.skia.ColorAlphaType
import org.jetbrains.skia.ColorType
import org.jetbrains.skia.ImageInfo
import java.awt.Desktop
import java.io.File
import java.util.prefs.Preferences
import kotlin.system.exitProcess

fun main(args: Array<String>) {
    if (args.firstOrNull() == "--selftest") exitProcess(SelfTest.run(args.drop(1)))
    application {
        Window(onCloseRequest = ::exitApplication, title = "RawRec Desktop", state = rememberWindowState(width = 1360.dp, height = 860.dp)) {
            App()
        }
    }
}

/** The owner's choices, kept between runs. */
private object Saved {
    private val p = Preferences.userRoot().node("rawrec-desktop")
    fun int(k: String, d: Int) = p.getInt(k, d)
    fun str(k: String, d: String) = p.get(k, d) ?: d
    fun bool(k: String, d: Boolean) = p.getBoolean(k, d)
    fun put(k: String, v: Int) = p.putInt(k, v)
    fun put(k: String, v: String) = p.put(k, v)
    fun put(k: String, v: Boolean) = p.putBoolean(k, v)
}

private val Bg = Color(0xFF0E1116)
private val Panel = Color(0xFF161B22)
private val Card = Color(0xFF1F2630)
private val Line = Color(0xFF2D3642)
private val Accent = Color(0xFF4C8DFF)
private val Rec = Color(0xFFFF3B47)
private val TextHi = Color(0xFFE9EDF2)
private val TextLo = Color(0xFF9AA6B5)
private val Ok = Color(0xFF3DDC84)

/** Vazirmatn when it ships with the app (Persian shaped properly on every system), else the system's font. */
private val appFont: FontFamily by lazy {
    val cl = Thread.currentThread().contextClassLoader
    if (cl.getResource("fonts/Vazirmatn-Regular.ttf") != null)
        FontFamily(Font("fonts/Vazirmatn-Regular.ttf", FontWeight.Normal), Font("fonts/Vazirmatn-Bold.ttf", FontWeight.Bold))
    else FontFamily.Default
}

@Composable
fun App() {
    val typo = Typography().let { t ->
        fun TextStyle.f() = copy(fontFamily = appFont)
        t.copy(bodyLarge = t.bodyLarge.f(), bodyMedium = t.bodyMedium.f(), bodySmall = t.bodySmall.f(), titleMedium = t.titleMedium.f(),
            titleLarge = t.titleLarge.f(), labelLarge = t.labelLarge.f(), labelMedium = t.labelMedium.f(), labelSmall = t.labelSmall.f())
    }
    MaterialTheme(colorScheme = darkColorScheme(primary = Accent, onPrimary = Color.White, background = Bg, surface = Panel, onSurface = TextHi), typography = typo) {
        CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
            Surface(Modifier.fillMaxSize(), color = Bg) { Studio() }
        }
    }
}

@Composable
private fun Studio() {
    val adb = remember { Adb.find() }
    var st by remember { mutableStateOf(Session.State()) }
    val session = remember(adb) { adb?.let { Session(it) { s -> st = s } } }
    var devices by remember { mutableStateOf(emptyList<Adb.Device>()) }
    var serial by remember { mutableStateOf(Saved.str("serial", "")) }
    var encoders by remember { mutableStateOf<List<Encoders.Encoder>?>(null) }

    // phone link choices
    var codec by remember { mutableStateOf(Saved.str("codec", "h265")) }
    var inMbps by remember { mutableStateOf(Saved.int("inMbps", 40)) }
    var inSize by remember { mutableStateOf(Saved.int("inSize", 0)) }
    var inFps by remember { mutableStateOf(Saved.int("inFps", 60)) }
    // recording choices
    var encName by remember { mutableStateOf(Saved.str("encoder", "")) }
    var outH by remember { mutableStateOf(Saved.int("outH", 1080)) }
    var outFps by remember { mutableStateOf(Saved.int("outFps", 60)) }
    var outMbps by remember { mutableStateOf(Saved.int("outMbps", 40)) }
    var withAudio by remember { mutableStateOf(Saved.bool("audio", true)) }

    LaunchedEffect(Unit) {
        Thread { val e = Encoders.available(); encoders = e; if (e.none { it.name == encName }) encName = e.firstOrNull()?.name ?: "" }.apply { isDaemon = true; start() }
    }
    LaunchedEffect(adb) {
        if (adb == null) return@LaunchedEffect
        while (true) {
            val d = runCatching { adb.devices() }.getOrDefault(emptyList())
            devices = d
            if (d.none { it.serial == serial }) d.firstOrNull { it.usable }?.let { serial = it.serial }
            kotlinx.coroutines.delay(2000)
        }
    }

    Row(Modifier.fillMaxSize()) {
        // the settings, at the start (right) side
        Column(Modifier.width(390.dp).fillMaxHeight().background(Panel).verticalScroll(rememberScrollState()).padding(16.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Text("RawRec Desktop", style = MaterialTheme.typography.titleLarge, color = TextHi, fontWeight = FontWeight.Bold)
            Text("صفحهٔ گوشی با سیم، با کیفیتِ کامل؛ ضبط با کارتِ گرافیکِ همین کامپیوتر.", color = TextLo, fontSize = 13.sp)

            Section("گوشی") {
                if (adb == null) Text("adb پیدا نشد؛ برنامه را دوباره نصب کن.", color = Rec)
                else if (devices.isEmpty()) Text("گوشی را با کابل وصل کن و در «گزینه‌های توسعه‌دهنده» «اشکال‌زدایی USB» را روشن کن.", color = TextLo, fontSize = 13.sp)
                devices.forEach { d ->
                    val sel = d.serial == serial
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(if (sel) Accent.copy(alpha = 0.18f) else Card)
                        .border(1.dp, if (sel) Accent else Line, RoundedCornerShape(10.dp)).clickable { serial = d.serial; Saved.put("serial", d.serial) }.padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(10.dp).clip(CircleShape).background(if (d.usable) Ok else Rec))
                        Spacer(Modifier.width(10.dp))
                        Column {
                            Text(d.label, color = TextHi)
                            if (d.state == "unauthorized") Text("روی گوشی «اجازه» را بزن.", color = Rec, fontSize = 12.sp)
                            else if (!d.usable) Text(d.state, color = TextLo, fontSize = 12.sp)
                        }
                    }
                }
                val live = st.phase != Session.Phase.IDLE
                Button(onClick = {
                    val s = session ?: return@Button
                    if (live) Thread { s.disconnect() }.start()
                    else Thread { s.connect(serial, PhoneLink.Options(codec, inMbps, inSize, inFps, true)) }.start()
                }, enabled = session != null && (live || devices.any { it.serial == serial && it.usable }), modifier = Modifier.fillMaxWidth()) {
                    Text(if (live) "قطعِ اتصال" else "وصل شو و نشان بده")
                }
                st.error?.let { Text("خطا: $it", color = Rec, fontSize = 12.sp) }
            }

            Section("کیفیتِ گرفتن از گوشی") {
                Hint("هر چه بیشتر، تصویرِ رسیده به کامپیوتر به صفحهٔ گوشی نزدیک‌تر. کابل تا ۱۰۰ مگابیت را راحت می‌برد.")
                Chips("کُدک", listOf("h265" to "HEVC", "h264" to "H.264", "av1" to "AV1"), codec) { codec = it; Saved.put("codec", it) }
                Chips("مگابیت", listOf(20, 40, 60, 80, 100).map { it to "$it" }, inMbps) { inMbps = it; Saved.put("inMbps", it) }
                Chips("اندازه", listOf(0 to "اصلی", 2560 to "1440p", 1920 to "1080p"), inSize) { inSize = it; Saved.put("inSize", it) }
                Chips("فریم", listOf(30, 60, 90, 120).map { it to "$it" }, inFps) { inFps = it; Saved.put("inFps", it) }
                Hint("تغییرِ این‌ها از اتصالِ بعدی اثر می‌کند.")
            }

            Section("ضبط") {
                val list = encoders
                if (list == null) Text("در حالِ شناختنِ انکودرهای این کامپیوتر…", color = TextLo, fontSize = 13.sp)
                else list.forEach { e ->
                    val sel = e.name == encName
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(if (sel) Accent.copy(alpha = 0.18f) else Card)
                        .clickable { encName = e.name; Saved.put("encoder", e.name) }.padding(horizontal = 12.dp, vertical = 8.dp)) {
                        Text(e.label, color = if (sel) TextHi else TextLo, fontSize = 13.sp)
                    }
                }
                Chips("ارتفاع", listOf(720, 1080, 1440, 2160).map { it to "${it}p" }, outH) { outH = it; Saved.put("outH", it) }
                Chips("فریم", listOf(30, 60, 120).map { it to "$it" }, outFps) { outFps = it; Saved.put("outFps", it) }
                Chips("مگابیت", listOf(10, 20, 40, 60, 80).map { it to "$it" }, outMbps) { outMbps = it; Saved.put("outMbps", it) }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(withAudio, { withAudio = it; Saved.put("audio", it) })
                    Text("صدای گوشی (اندروید ۱۱ به بالا)", color = TextHi, fontSize = 13.sp)
                }
            }
        }

        // the picture
        Column(Modifier.weight(1f).fillMaxHeight().padding(16.dp)) {
            Box(Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Color.Black), contentAlignment = Alignment.Center) {
                PreviewImage(session)
                if (st.phase == Session.Phase.CONNECTING) Text("در حالِ وصل شدن…", color = TextLo)
                if (st.phase == Session.Phase.IDLE) Text("گوشی را وصل کن و «وصل شو» را بزن.", color = TextLo)
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                val enc = encoders?.firstOrNull { it.name == encName }
                val canRec = st.phase == Session.Phase.LIVE && enc != null
                Button(onClick = {
                    val s = session ?: return@Button
                    if (st.recording) Thread { s.stopRecording() }.start()
                    else if (enc != null) s.startRecording(enc, outH, outFps, outMbps * 1000, withAudio)
                }, enabled = canRec || st.recording, colors = ButtonDefaults.buttonColors(containerColor = Rec, contentColor = Color.White), modifier = Modifier.height(48.dp)) {
                    Text(if (st.recording) "■  پایانِ ضبط  ${clock(st.recSeconds)}" else "●  ضبط", fontWeight = FontWeight.Bold)
                }
                Column {
                    if (st.phase == Session.Phase.LIVE) Text("${st.device} • ${st.codec.uppercase()} ${st.width}×${st.height} • ${st.fps} فریم • ${"%.1f".format(st.mbps)} مگابیت • صدا: ${audioLabel(st.audio)}", color = TextHi, fontSize = 13.sp)
                    if (st.recording) Text("ضبط: ${st.recBytes / 1_048_576} مگابایت • فریمِ جامانده: ${st.recDropped}", color = TextLo, fontSize = 12.sp)
                    if (st.lastFile.isNotEmpty() && !st.recording) Text("آخرین ضبط: ${File(st.lastFile).name} — ${st.lastResult}", color = TextLo, fontSize = 12.sp)
                }
                Spacer(Modifier.weight(1f))
                OutlinedButton(onClick = { runCatching { Desktop.getDesktop().open(AppPaths.videos) } }) { Text("پوشهٔ ضبط‌ها") }
            }
        }
    }
}

/** The newest picture from the phone, at most once per screen refresh. */
@Composable
private fun PreviewImage(session: Session?) {
    var img by remember { mutableStateOf<ImageBitmap?>(null) }
    LaunchedEffect(session) {
        var last = 0L
        while (true) {
            withFrameNanos { }
            val p = session?.latest?.get()
            if (p == null) { if (img != null) img = null; continue }
            if (p.seq == last) continue
            last = p.seq
            val b = Bitmap()
            b.allocPixels(ImageInfo(p.width, p.height, ColorType.BGRA_8888, ColorAlphaType.OPAQUE))
            b.installPixels(p.bgra)
            img = b.asComposeImageBitmap()
        }
    }
    img?.let { Image(it, null, Modifier.fillMaxSize(), contentScale = ContentScale.Fit) }
}

@Composable
private fun Section(title: String, body: @Composable ColumnScope.() -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Card.copy(alpha = 0.55f)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(title, color = TextHi, fontWeight = FontWeight.Bold, fontSize = 15.sp)
        body()
    }
}

@Composable
private fun Hint(t: String) = Text(t, color = TextLo, fontSize = 12.sp)

@Composable
private fun <T> Chips(label: String, items: List<Pair<T, String>>, selected: T, onPick: (T) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text(label, color = TextLo, fontSize = 12.sp)
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items.forEach { (v, t) ->
                val sel = v == selected
                Box(Modifier.clip(RoundedCornerShape(16.dp)).background(if (sel) Accent else Card).border(1.dp, if (sel) Accent else Line, RoundedCornerShape(16.dp))
                    .clickable { onPick(v) }.padding(horizontal = 12.dp, vertical = 6.dp)) {
                    Text(t, color = if (sel) Color.White else TextHi, fontSize = 13.sp)
                }
            }
        }
    }
}

private fun clock(s: Long) = "%02d:%02d".format(s / 60, s % 60)
private fun audioLabel(a: String) = when (a) { "on" -> "دارد"; "" -> "…"; "disabled" -> "ندارد (اندروید زیرِ ۱۱)"; else -> "ندارد ($a)" }
