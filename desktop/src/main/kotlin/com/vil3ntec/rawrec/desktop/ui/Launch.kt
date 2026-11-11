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
import kotlinx.coroutines.launch
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
import androidx.compose.ui.input.key.*
import kotlinx.coroutines.delay
import java.awt.Desktop

/** The window's keys go to whatever screen is showing (set by it). */
object Keys { @Volatile var handler: ((KeyEvent) -> Boolean)? = null }

fun launch() = application {
    val app = remember { StudioApp(Adb.find()) }
    Window(onCloseRequest = { app.close(); exitApplication() }, title = "RawRec Studio",
        state = rememberWindowState(size = DpSize(1480.dp, 900.dp)), onKeyEvent = { Keys.handler?.invoke(it) ?: false }) {
        MaterialTheme(colorScheme = darkColorScheme(primary = K.Accent, onPrimary = Color.Black, background = K.Bg, surface = K.Raised, onSurface = K.Text)) {
            CompositionLocalProvider(LocalLayoutDirection provides LayoutDirection.Rtl) {
                Box(Modifier.fillMaxSize().background(K.Bg)) { Studio(app) }
            }
        }
    }
}

private enum class Tab(val mark: String, val label: String) {
    PROPS("◧", "لایه"), SOURCE("▣", "منبع"), REC("●", "ضبط"), LIVE("◉", "پخش"), CHAT("☰", "چت"), SETTINGS("⚙", "تنظیمات"), STATS("▤", "آمار")
}

@Composable
fun Studio(app: StudioApp) {
    var studio by remember { mutableStateOf(app.studio) }
    var selected by remember { mutableStateOf<String?>(null) }
    var tab by remember { mutableStateOf(Tab.SOURCE) }
    var tick by remember { mutableStateOf(0) }
    var devices by remember { mutableStateOf<List<Adb.Device>>(emptyList()) }
    var encoders by remember { mutableStateOf<List<Encoders.Encoder>?>(null) }
    var message by remember { mutableStateOf<String?>(null) }
    var editing by remember { mutableStateOf(false) }
    val webcams = remember { lazy { Devices.webcams() } }
    fun edit(s: Studio) { app.edit(s, "ui"); studio = app.studio }
    var clipboard by remember { mutableStateOf<Layer?>(null) }
    // keys, as in OBS and every editor: undo, delete, duplicate, copy/paste, nudge; record/live/replay/screenshot; scenes 1–9
    Keys.handler = h@{ e ->
        if (e.type != KeyEventType.KeyDown) return@h false
        val ctrl = e.isCtrlPressed || e.isMetaPressed
        val sel = studio.editing.layers.firstOrNull { it.id == selected }
        fun nudge(dx: Float, dy: Float): Boolean { val l = sel ?: return false; if (l.locked) return false
            val k = if (e.isShiftPressed) 10f else 1f; edit(studio.withLayer(l.copy(x = l.x + dx * k, y = l.y + dy * k))); return true }
        when {
            ctrl && e.key == Key.Z && !e.isShiftPressed -> { if (app.undo()) studio = app.studio; true }
            ctrl && (e.key == Key.Y || (e.key == Key.Z && e.isShiftPressed)) -> { if (app.redo()) studio = app.studio; true }
            ctrl && e.key == Key.D -> { sel?.let { l -> studio.duplicate(l.id)?.let { (s2, c) -> edit(s2); selected = c.id } }; true }
            ctrl && e.key == Key.C -> { clipboard = sel; sel != null }
            ctrl && e.key == Key.V -> { clipboard?.let { l -> studio.paste(l)?.let { (s2, c) -> edit(s2); selected = c.id } }; clipboard != null }
            ctrl && !e.isAltPressed && e.key.keyCode in Key.One.keyCode..Key.Nine.keyCode -> {
                val i = (e.key.keyCode - Key.One.keyCode).toInt()
                studio.scenes.getOrNull(i)?.let { sc -> edit(studio.open(sc.id)) }; true
            }
            e.key == Key.Delete || e.key == Key.Backspace -> { sel?.let { l -> edit(studio.removeLayer(l.id)); selected = null }; sel != null }
            e.key == Key.Escape -> { selected = null; true }
            e.key == Key.DirectionLeft -> nudge(-1f, 0f)
            e.key == Key.DirectionRight -> nudge(1f, 0f)
            e.key == Key.DirectionUp -> nudge(0f, -1f)
            e.key == Key.DirectionDown -> nudge(0f, 1f)
            e.key == Key.F9 -> { if (app.recording != null) Thread { app.stopRecording() }.start() else message = app.startRecording(); true }
            e.key == Key.F10 -> { if (app.onAir) app.stopLive() else message = app.startLive(); true }
            e.key == Key.F8 -> { app.pauseRecording(); true }
            e.key == Key.F11 -> { Thread { app.saveReplay() }.start(); true }
            e.key == Key.F12 -> { app.screenshot(); true }
            else -> false
        }
    }

    // the same actions from anywhere on the computer (Ctrl+Alt+…), handed to the window's thread
    val scope = rememberCoroutineScope()
    DisposableEffect(app.settings.globalKeys) {
        if (app.settings.globalKeys) {
            GlobalKeys.onAction = { a -> scope.launch {
                when (a) {
                    GlobalKeys.Action.RECORD -> if (app.recording != null) Thread { app.stopRecording() }.start() else message = app.startRecording()
                    GlobalKeys.Action.LIVE -> if (app.onAir) app.stopLive() else message = app.startLive()
                    GlobalKeys.Action.PAUSE -> app.pauseRecording()
                    GlobalKeys.Action.REPLAY -> Thread { app.saveReplay() }.start()
                    GlobalKeys.Action.SCREENSHOT -> app.screenshot()
                }
            } }
            GlobalKeys.onScene = { i -> scope.launch { studio.scenes.getOrNull(i)?.let { sc -> edit(studio.open(sc.id)) } } }
            Thread { GlobalKeys.start() }.apply { isDaemon = true; start() }
        } else GlobalKeys.stop()
        onDispose { GlobalKeys.onAction = null; GlobalKeys.onScene = null }
    }
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
    val onAir = app.onAir

    Column(Modifier.fillMaxSize()) {
        TopBar(app, st, recording, onAir, tick, editing, { editing = it },
            onStudioMode = { on -> edit(if (on) studio.copy(preview = studio.current) else studio.copy(preview = null)) },
            onUndo = { if (app.undo()) studio = app.studio }, onRedo = { if (app.redo()) studio = app.studio })
        HLine()
        if (editing) Box(Modifier.weight(1f)) { EditorScreen(encoders) }
        else Row(Modifier.weight(1f)) {
            // start side (right in Persian): scenes and layers
            Column(Modifier.width(300.dp).fillMaxHeight().background(K.Panel).verticalScroll(rememberScrollState())) {
                ScenesPanel(studio, ::edit, recording || onAir)
                LayersPanel(studio, selected, { selected = it; if (it != null) tab = Tab.PROPS }, ::edit, { webcams.value })
            }
            Box(Modifier.width(1.dp).fillMaxHeight().background(K.Line))
            // the program and the big buttons
            Column(Modifier.weight(1f).fillMaxHeight().padding(12.dp)) {
                val box = Modifier.clip(RoundedCornerShape(8.dp)).border(1.dp, K.Line, RoundedCornerShape(8.dp))
                if (studio.preview == null) Row(Modifier.weight(1f).fillMaxWidth()) {
                    ProgramView(app, studio, selected, { selected = it; if (it != null) tab = Tab.PROPS }, ::edit, st.phase == Session.Phase.LIVE,
                        Modifier.weight(1f).fillMaxHeight().then(box))
                    // the upright output beside the main one (as a second canvas); a click opens it for editing
                    val vs = studio.verticalScene
                    if (vs != null && !studio.editing.vertical) {
                        Spacer(Modifier.width(8.dp))
                        Column(Modifier.width(170.dp).fillMaxHeight()) {
                            T("عمودی ۹:۱۶: ${vs.name}", 11, K.Accent, bold = true, maxLines = 1)
                            VerticalMini(app, Modifier.fillMaxWidth().aspectRatio(studio.vWidth / studio.vHeight.toFloat()).then(box).clickable { edit(studio.open(vs.id)) })
                            T("برای ویرایش کلیک کن", 10, K.Faint)
                        }
                    }
                }
                else Row(Modifier.weight(1f).fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    // studio mode, as OBS: the scene being prepared (editable) beside what is on air
                    Column(Modifier.weight(1f)) {
                        T("آماده: ${studio.editing.name}", 12, K.Accent, bold = true)
                        ProgramView(app, studio, selected, { selected = it; if (it != null) tab = Tab.PROPS }, ::edit, st.phase == Session.Phase.LIVE,
                            Modifier.fillMaxWidth().aspectRatio(studio.width / studio.height.toFloat()).then(box), prepared = true)
                    }
                    Column(Modifier.padding(horizontal = 8.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Btn("گذار ⟵", { edit(studio.copy(current = studio.preview!!)) }, on = true, height = 40.dp, bold = true)
                        T(studio.transition.name.lowercase(), 11, K.Faint)
                    }
                    Column(Modifier.weight(1f)) {
                        T("روی آنتن: ${studio.scene.name}", 12, K.Live, bold = true)
                        ProgramView(app, studio, null, {}, {}, st.phase == Session.Phase.LIVE,
                            Modifier.fillMaxWidth().aspectRatio(studio.width / studio.height.toFloat()).then(box), interactive = false)
                    }
                }
                Spacer(Modifier.height(10.dp))
                Transport(app, recording, onAir, tick, { message = it })
                message?.let { T(it, 12, K.Live, modifier = Modifier.padding(top = 6.dp).clickable { message = null }) }
            }
            Box(Modifier.width(1.dp).fillMaxHeight().background(K.Line))
            // end side: the inspector with its tabs
            Column(Modifier.width(380.dp).fillMaxHeight().background(K.Panel)) {
                TabBar(Tab.entries.map { Triple(it, it.mark, it.label) }, tab, { tab = it })
                HLine()
                Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(vertical = 5.dp)) {
                    when (tab) {
                        Tab.PROPS -> Inspector(app, studio, selected, ::edit) { webcams.value }
                        Tab.SOURCE -> SourcePanel(app, devices, st, studio, ::edit, recording || onAir)
                        Tab.REC -> RecordPanel(app, encoders, studio, recording)
                        Tab.LIVE -> LivePanel(app, encoders, onAir)
                        Tab.SETTINGS -> SettingsPanel(app, studio, ::edit, recording || onAir)
                        Tab.CHAT -> ChatPanel(app)
                        Tab.STATS -> StatsPanel(app, tick)
                    }
                }
            }
        }
        HLine()
        MixerBar(app, tick)
    }
}

@Composable
private fun TopBar(app: StudioApp, st: Session.State, recording: Boolean, onAir: Boolean, tick: Int, editing: Boolean, onMode: (Boolean) -> Unit,
                   onStudioMode: (Boolean) -> Unit, onUndo: () -> Unit, onRedo: () -> Unit) {
    @Suppress("UNUSED_VARIABLE") val refresh = tick     // read every 200 ms: the numbers below are not Compose state
    Row(Modifier.fillMaxWidth().height(46.dp).background(K.Panel).padding(horizontal = 14.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(22.dp).clip(RoundedCornerShape(6.dp)).background(K.Accent), contentAlignment = Alignment.Center) { T("R", 13, Color.Black, bold = true) }
        T("RawRec Studio", 15, bold = true)
        Spacer(Modifier.width(16.dp))
        Seg(listOf(false to "استودیو", true to "ویرایش"), editing, onMode, Modifier.width(200.dp))
        if (!editing) {
            Btn("حالتِ استودیو", { onStudioMode(app.studio.preview == null) }, on = app.studio.preview != null, height = 28.dp)
            Btn("↶", onUndo, enabled = app.history.canUndo, height = 28.dp)
            Btn("↷", onRedo, enabled = app.history.canRedo, height = 28.dp)
        }
        Spacer(Modifier.weight(1f))
        val s = app.studio
        Pill("${s.width}×${s.height} • ${s.fps} فریم")
        Pill("موتور ${app.engine.fps} فریم • ${"%.1f".format(app.engine.drawMs)} ms" + if (app.engine.late > 0) " • جامانده ${app.engine.late}" else "",
            dot = if (app.engine.fps >= s.fps - 2) K.Good else K.Warn)
        // what the picture comes from now
        val usesPhone = s.scene.layers.any { l -> l.visible && s.source(l.sourceId)?.kind == SourceKind.PHONE }
        val usesScreen = s.scene.layers.any { l -> l.visible && s.source(l.sourceId)?.kind == SourceKind.SCREEN }
        if (usesScreen) Pill("کامپیوتر: در حالِ گرفتن", dot = K.Good)
        if (usesPhone || !usesScreen) Pill(when (st.phase) { Session.Phase.LIVE -> "گوشی: ${st.device}"; Session.Phase.CONNECTING -> "گوشی: وصل می‌شود…"; else -> "گوشی وصل نیست" },
            dot = when (st.phase) { Session.Phase.LIVE -> K.Good; Session.Phase.CONNECTING -> K.Warn; else -> K.Faint })
        if (app.replay != null) Pill("بازپخش ${"%.0f".format(app.replay?.heldSeconds ?: 0.0)} ث", K.Amber, K.Amber)
        if (recording) Pill((if (app.recording?.paused == true) "❚❚ مکث " else "● ضبط ") + clock((System.currentTimeMillis() - (app.recording?.startedAtMs ?: 0)) / 1000), K.Live, K.Live)
        if (onAir) Pill("روی آنتن ${clock((System.currentTimeMillis() - app.liveStartedMs) / 1000)}", K.Live, K.Live)
    }
}

@Composable
private fun Transport(app: StudioApp, recording: Boolean, onAir: Boolean, tick: Int, onMessage: (String?) -> Unit) {
    @Suppress("UNUSED_VARIABLE") val refresh = tick
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        BigButton(if (recording) "■  پایانِ ضبط  ${clock((System.currentTimeMillis() - (app.recording?.startedAtMs ?: 0)) / 1000)}" else "●  ضبط", recording) {
            if (recording) Thread { app.stopRecording() }.start() else onMessage(app.startRecording())
        }
        BigButton(if (onAir) "■  پایانِ پخش  ${clock((System.currentTimeMillis() - app.liveStartedMs) / 1000)}" else "◉  شروعِ پخشِ زنده", onAir) {
            if (onAir) app.stopLive() else onMessage(app.startLive())
        }
        if (recording) Btn(if (app.recording?.paused == true) "▶ ادامه" else "❚❚ مکث", { app.pauseRecording() }, on = app.recording?.paused == true, tint = K.Amber, height = 44.dp)
        Column {
            Btn(if (app.replay != null) "بافرِ بازپخش: روشن" else "بافرِ بازپخش", { if (app.replay != null) app.stopReplay() else onMessage(app.startReplay()) },
                on = app.replay != null, tint = K.Amber, height = 21.dp)
            Spacer(Modifier.height(2.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                Btn("ذخیرهٔ بازپخش", { Thread { app.saveReplay() }.start() }, enabled = app.replay != null, height = 21.dp)
                Btn("عکس", { app.screenshot() }, height = 21.dp)
            }
        }
        // the studio as a camera for Zoom, Meet, Discord…
        Column {
            Btn(if (app.vcam != null) "دوربینِ مجازی: روشن" else "دوربینِ مجازی", { onMessage(if (app.vcam != null) { app.stopVirtualCamera(); null } else app.startVirtualCamera()) },
                on = app.vcam != null, tint = K.Accent, height = 21.dp)
            Spacer(Modifier.height(2.dp))
            val vc = app.vcam
            T(when {
                vc?.error != null -> vc.error!!
                vc != null && vc.watched -> "برنامه‌ای آن را نشان می‌دهد"
                vc != null -> "در Zoom/Meet/Discord «${VirtualCamera.NAME}» را انتخاب کن"
                else -> ""
            }, 10, if (vc?.error != null) K.Live else K.Faint, maxLines = 1)
        }
        Column(Modifier.weight(1f)) {
            app.lastSaved?.let { T("ذخیره شد: $it", 12, K.Good, maxLines = 1) }
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
