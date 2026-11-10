package com.vil3ntec.rawrec.desktop.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Window
import androidx.compose.ui.window.application
import androidx.compose.ui.window.rememberWindowState
import com.vil3ntec.rawrec.RtmpSink
import com.vil3ntec.rawrec.desktop.Adb
import com.vil3ntec.rawrec.desktop.AppPaths
import com.vil3ntec.rawrec.desktop.Encoders
import com.vil3ntec.rawrec.desktop.Session
import com.vil3ntec.rawrec.desktop.studio.*
import kotlinx.coroutines.delay
import java.awt.Desktop

fun launch() = application {
    val app = remember { StudioApp(Adb.find()) }
    Window(onCloseRequest = { app.close(); exitApplication() }, title = "RawRec Studio",
        state = rememberWindowState(size = DpSize(1480.dp, 900.dp))) {
        MaterialTheme(colorScheme = darkColorScheme(primary = K.Accent, onPrimary = Color.Black, background = K.Bg, surface = K.Raised, onSurface = K.Text)) {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                Box(Modifier.fillMaxSize().background(K.Bg)) { Studio(app) }
            }
        }
    }
}

private enum class Tab(val label: String) { PROPS("ویژگی‌ها"), OUTPUT("خروجی"), PHONE("گوشی"), CHAT("چت") }

@Composable
fun Studio(app: StudioApp) {
    var studio by remember { mutableStateOf(app.studio) }
    var selected by remember { mutableStateOf<String?>(null) }
    var tab by remember { mutableStateOf(Tab.PROPS) }
    var tick by remember { mutableStateOf(0) }
    var devices by remember { mutableStateOf<List<Adb.Device>>(emptyList()) }
    var encoders by remember { mutableStateOf<List<Encoders.Encoder>?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf(false) }
    val webcams = remember { lazy { Devices.webcams() } }
    fun edit(s: Studio) { studio = s; app.studio = s; studio = app.studio }

    LaunchedEffect(Unit) { Thread { encoders = Encoders.available() }.apply { isDaemon = true; start() } }
    LaunchedEffect(Unit) { while (true) { delay(200); tick++ } }
    LaunchedEffect(Unit) {
        while (true) {
            val a = app.adb
            if (a != null) devices = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { a.devices() }
            delay(2000)
        }
    }
    val st = remember(tick) { app.session?.state ?: Session.State() }
    val recording = app.recording != null
    val onAir = app.live != null

    Column(Modifier.fillMaxSize()) {
        TopBar(app, st, recording, onAir, tick, editing) { editing = it }
        HLine()
        if (editing) Box(Modifier.weight(1f)) { EditorScreen(encoders) }
        else Row(Modifier.weight(1f)) {
            // start side (right in Persian): scenes and layers
            Column(Modifier.width(300.dp).fillMaxHeight().background(K.Panel).verticalScroll(rememberScrollState())) {
                ScenesPanel(studio, ::edit, recording || onAir)
                HLine()
                LayersPanel(studio, selected, { selected = it; if (it != null) tab = Tab.PROPS }, ::edit, { webcams.value })
            }
            Box(Modifier.width(1.dp).fillMaxHeight().background(K.Line))
            // the program and the big buttons
            Column(Modifier.weight(1f).fillMaxHeight().padding(12.dp)) {
                ProgramView(app, studio, selected, { selected = it; if (it != null) tab = Tab.PROPS }, ::edit, st.phase == Session.Phase.LIVE,
                    Modifier.weight(1f).fillMaxWidth().clip(RoundedCornerShape(8.dp)).border(1.dp, K.Line, RoundedCornerShape(8.dp)))
                Spacer(Modifier.height(10.dp))
                Transport(app, recording, onAir, tick, { message = it })
                message?.let { T(it, 12, K.Live, modifier = Modifier.padding(top = 6.dp).clickable { message = null }) }
            }
            Box(Modifier.width(1.dp).fillMaxHeight().background(K.Line))
            // end side: the inspector with its tabs
            Column(Modifier.width(360.dp).fillMaxHeight().background(K.Panel)) {
                Row(Modifier.fillMaxWidth().padding(8.dp), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (t in Tab.entries) Btn(t.label, { tab = t }, Modifier.weight(1f), on = tab == t, height = 28.dp)
                }
                HLine()
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                    when (tab) {
                        Tab.PROPS -> Inspector(app, studio, selected, ::edit) { webcams.value }
                        Tab.OUTPUT -> OutputPanel(app, encoders, studio, ::edit, recording, onAir)
                        Tab.PHONE -> PhonePanel(app, devices, st, recording || onAir)
                        Tab.CHAT -> ChatPanel(app)
                    }
                }
            }
        }
        HLine()
        MixerBar(app, tick)
    }
}

@Composable
private fun TopBar(app: StudioApp, st: Session.State, recording: Boolean, onAir: Boolean, tick: Int, editing: Boolean, onMode: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().height(46.dp).background(K.Panel).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(22.dp).clip(RoundedCornerShape(6.dp)).background(K.Accent), contentAlignment = Alignment.Center) { T("R", 13, Color.Black, bold = true) }
        T("RawRec Studio", 15, bold = true)
        Spacer(Modifier.width(16.dp))
        Seg(listOf(false to "استودیو", true to "ویرایش"), editing, onMode, Modifier.width(200.dp))
        Spacer(Modifier.weight(1f))
        val s = app.studio
        Pill("${s.width}×${s.height} • ${s.fps} فریم")
        Pill("موتور ${app.engine.fps} فریم • ${"%.1f".format(app.engine.drawMs)} ms" + if (app.engine.late > 0) " • جامانده ${app.engine.late}" else "",
            dot = if (app.engine.fps >= s.fps - 2) K.Good else K.Warn)
        Pill(when (st.phase) { Session.Phase.LIVE -> "گوشی: ${st.device}"; Session.Phase.CONNECTING -> "گوشی: وصل می‌شود…"; else -> "گوشی وصل نیست" },
            dot = when (st.phase) { Session.Phase.LIVE -> K.Good; Session.Phase.CONNECTING -> K.Warn; else -> K.Faint })
        if (recording) Pill("● ضبط ${clock((System.currentTimeMillis() - (app.recording?.startedAtMs ?: 0)) / 1000)}", K.Live, K.Live)
        if (onAir) Pill("روی آنتن ${clock((System.currentTimeMillis() - app.liveStartedMs) / 1000)}", K.Live, K.Live)
    }
}

@Composable
private fun Transport(app: StudioApp, recording: Boolean, onAir: Boolean, tick: Int, onMessage: (String?) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        BigButton(if (recording) "■  پایانِ ضبط  ${clock((System.currentTimeMillis() - (app.recording?.startedAtMs ?: 0)) / 1000)}" else "●  ضبط", recording) {
            if (recording) Thread { app.stopRecording() }.start() else onMessage(app.startRecording())
        }
        BigButton(if (onAir) "■  پایانِ پخش  ${clock((System.currentTimeMillis() - app.liveStartedMs) / 1000)}" else "◉  شروعِ پخشِ زنده", onAir) {
            if (onAir) app.stopLive() else onMessage(app.startLive())
        }
        Column(Modifier.weight(1f)) {
            app.recording?.let { r -> T("ضبط: ${r.bytes / 1_048_576} مگابایت • فریمِ جامانده ${r.dropped}", 12, K.Dim) }
            app.liveStatus?.let { s -> T("پخش: " + destState(s), 12, if (s.state == RtmpSink.State.LIVE) K.Good else K.Warn, maxLines = 1) }
            if (!recording) app.lastRecording?.let { r ->
                T("آخرین ضبط: ${r.file.name} • ${r.width}×${r.height} • ${"%.1f".format(r.seconds)} ث • ${r.frames} فریم • ${r.bytes / 1_048_576} مگابایت" + (r.error?.let { " • خطا: $it" } ?: ""),
                    12, if (r.error != null) K.Live else K.Dim, maxLines = 1)
            }
        }
        Btn("پوشهٔ ضبط‌ها", { runCatching { Desktop.getDesktop().open(AppPaths.videos) } }, height = 40.dp)
    }
}

@Composable
private fun BigButton(text: String, on: Boolean, onClick: () -> Unit) {
    Box(Modifier.height(44.dp).widthIn(min = 170.dp).clip(RoundedCornerShape(8.dp))
        .background(if (on) K.Live else K.Raised).border(1.dp, if (on) K.Live else K.LineHi, RoundedCornerShape(8.dp))
        .clickable { onClick() }.padding(horizontal = 18.dp), contentAlignment = Alignment.Center) {
        T(text, 14, if (on) Color.White else K.Text, bold = true, maxLines = 1)
    }
}
