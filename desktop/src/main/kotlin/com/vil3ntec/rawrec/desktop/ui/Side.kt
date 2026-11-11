package com.vil3ntec.rawrec.desktop.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.vil3ntec.rawrec.RtmpSink
import com.vil3ntec.rawrec.desktop.Adb
import com.vil3ntec.rawrec.desktop.Encoders
import com.vil3ntec.rawrec.desktop.Session
import com.vil3ntec.rawrec.desktop.studio.*

/**
 * Where the picture comes from: the first question is answered with one click (the phone, this computer, or both), then
 * each one's own settings. Changing it rebuilds only the main scene's picture layer; titles, chat, cameras stay.
 */
@Composable
fun SourcePanel(app: StudioApp, devices: List<Adb.Device>, st: Session.State, studio: Studio, onEdit: (Studio) -> Unit, locked: Boolean) {
    val from = studio.mainFrom
    Section("تصویرِ اصلی از کجا بیاید؟", subtitle = "یکی را بزن؛ بقیهٔ صحنه (متن، چت، وب‌کم) سرِ جایش می‌ماند.") {
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Tile("▯", "گوشی", "با کابل، کیفیتِ بالا", from == Studio.MainFrom.PHONE, { onEdit(studio.useMain(Studio.MainFrom.PHONE)) }, Modifier.weight(1f))
            Tile("▭", "همین کامپیوتر", "صفحه، بازی یا پنجره", from == Studio.MainFrom.COMPUTER, { onEdit(studio.useMain(Studio.MainFrom.COMPUTER)) }, Modifier.weight(1f))
            Tile("⧉", "هر دو", "صفحه + گوشی در گوشه", from == Studio.MainFrom.BOTH, { onEdit(studio.useMain(Studio.MainFrom.BOTH)) }, Modifier.weight(1f))
        }
        if (from == null) Hint("صحنهٔ فعلی را خودت چیده‌ای؛ با زدنِ یکی از این‌ها فقط تصویرِ اصلی‌اش عوض می‌شود.")
    }
    val usesScreen = from == Studio.MainFrom.COMPUTER || from == Studio.MainFrom.BOTH || studio.scene.layers.any { studio.source(it.sourceId)?.kind == SourceKind.SCREEN }
    val usesPhone = from != Studio.MainFrom.COMPUTER
    if (usesScreen) studio.sources.firstOrNull { it.kind == SourceKind.SCREEN }?.let { src ->
        Section("صفحهٔ کامپیوتر") { ScreenSettings(app, src) { ns -> onEdit(studio.withSource(ns)) } }
    }
    if (usesPhone) PhoneSettings(app, devices, st, locked)
    else Section("گوشی") { T("الان از گوشی استفاده نمی‌شود. برای پخشِ بازیِ گوشی «گوشی» یا «هر دو» را بزن.", 12, K.Dim) }
}

/** One screen source's settings: which monitor (or window), frame rate, the mouse, and on Windows how it is captured. */
@Composable
fun ScreenSettings(app: StudioApp, src: SourceDef, set: (SourceDef) -> Unit) {
    val win = System.getProperty("os.name").lowercase().contains("win")
    val mons = remember { Devices.monitors() }
    if (mons.size > 1) {
        Label("کدام مانیتور")
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for (m in mons) Btn(m.label, { set(src.with("display", m.index.toString()).with("window", "")) }, Modifier.fillMaxWidth(),
                on = src.prop("window").isBlank() && (src.prop("display").toIntOrNull() ?: 0) == m.index, height = 28.dp)
        }
    } else if (mons.size == 1) T(mons[0].label, 12, K.Dim)
    if (win) {
        Label("فقط یک پنجره (اختیاری) — عنوانِ همان پنجره را بنویس")
        var w by remember(src.id) { mutableStateOf(src.prop("window")) }
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp), verticalAlignment = Alignment.CenterVertically) {
            Field(w, { w = it }, Modifier.weight(1f), hint = "خالی = کلِ مانیتور")
            Btn("اعمال", { set(src.with("window", w.trim())) }, height = 30.dp)
        }
    }
    Label("فریم در ثانیه")
    Seg(listOf("" to "مثلِ استودیو", "30" to "30", "60" to "60"), src.prop("fps"), { set(src.with("fps", it)) })
    Label("نشانگرِ ماوس")
    Seg(listOf("1" to "نشان بده", "0" to "پنهان"), src.prop("cursor", "1"), { set(src.with("cursor", it)) })
    if (win) {
        Label("روشِ گرفتن")
        Seg(listOf("auto" to "سریع (کارتِ گرافیک)", "gdi" to "سازگار"), src.prop("method", "auto"), { set(src.with("method", it)) })
        Hint(if (Devices.hasDda) "«سریع» صفحه را با کارتِ گرافیک می‌گیرد: بازی‌های تمام‌صفحه هم، با کمترین بار روی پردازنده."
             else "روشِ سریع در این ویندوز در دسترس نیست؛ روشِ سازگار به کار می‌رود.")
    }
    app.engine.sourceError(src.id)?.let { Hint("گرفتنِ صفحه نشد: $it", K.Live) }
}

@Composable
fun PhoneSettings(app: StudioApp, devices: List<Adb.Device>, st: Session.State, locked: Boolean) {
    val s = app.settings
    var serial by remember { mutableStateOf<String?>(null) }
    if (serial == null || devices.none { it.serial == serial }) serial = devices.firstOrNull { it.usable }?.serial
    val live = st.phase != Session.Phase.IDLE
    Section("گوشی با کابل", subtitle = "گوشی را وصل کن و در «گزینه‌های توسعه‌دهنده» «اشکال‌زدایی USB» را روشن کن.") {
        if (app.adb == null) T("adb پیدا نشد؛ برنامه را دوباره نصب کن.", 12, K.Live)
        else if (devices.isEmpty()) T("گوشی‌ای پیدا نشد.", 12, K.Dim)
        for (d in devices) {
            val on = d.serial == serial
            Row(Modifier.fillMaxWidth().padding(bottom = 4.dp).clip(RoundedCornerShape(8.dp)).background(if (on) K.AccentDim else K.Raised)
                .border(1.dp, if (on) K.Accent else K.Line, RoundedCornerShape(8.dp)).clickable(enabled = d.usable && !live) { serial = d.serial }.padding(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(8.dp).clip(RoundedCornerShape(50)).background(if (d.usable) K.Good else K.Warn))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    T(d.label, 13, maxLines = 1)
                    if (d.state == "unauthorized") T("روی گوشی «اجازه» را بزن", 11, K.Warn) else if (!d.usable) T(d.state, 11, K.Dim)
                }
            }
        }
        Spacer(Modifier.height(4.dp))
        Btn(if (live) "قطعِ اتصال" else "وصل شو", { if (live) app.disconnect() else serial?.let { app.connect(it) } },
            Modifier.fillMaxWidth(), on = live, enabled = live || serial != null, height = 36.dp, bold = true)
        if (st.phase == Session.Phase.CONNECTING) Hint("در حالِ وصل شدن…", K.Dim)
        if (st.phase == Session.Phase.LIVE) Hint("${st.device} • ${st.codec.uppercase()} ${st.width}×${st.height} • ${st.fps} فریم • ${"%.1f".format(st.mbps)} مگابیت", K.Accent)
        st.error?.let { Hint(it, K.Live) }
    }
    Section("کیفیتِ تصویرِ گوشی", subtitle = "هر چه بیشتر، نزدیک‌تر به خودِ صفحهٔ گوشی. از اتصالِ بعدی اثر دارد.") {
        Label("کدک")
        Seg(listOf("h265" to "HEVC", "h264" to "H.264", "av1" to "AV1"), s.phoneCodec, { v -> app.update { it.copy(phoneCodec = v) } }, enabled = !live)
        Label("حجمِ داده (مگابیت در ثانیه)")
        Seg(listOf(20 to "20", 40 to "40", 60 to "60", 80 to "80", 100 to "100"), s.phoneMbps, { v -> app.update { it.copy(phoneMbps = v) } }, enabled = !live)
        Label("اندازه")
        Seg(listOf(0 to "اصلی", 2560 to "1440p", 1920 to "1080p"), s.phoneSize, { v -> app.update { it.copy(phoneSize = v) } }, enabled = !live)
        Label("فریم در ثانیه")
        Seg(listOf(30 to "30", 60 to "60", 90 to "90", 120 to "120"), s.phoneFps, { v -> app.update { it.copy(phoneFps = v) } }, enabled = !live)
    }
}

/** Recording: encoder, file size and quality, long recordings, the upright file, the replay buffer. */
@Composable
fun RecordPanel(app: StudioApp, encoders: List<Encoders.Encoder>?, studio: Studio, recording: Boolean) {
    val s = app.settings
    Section("انکودر", subtitle = "کارتِ گرافیکِ همین کامپیوتر اول می‌آید: سریع‌تر و بی‌فشار روی بازی.") {
        EncoderPick(encoders, s.recEncoder, null, enabled = !recording) { v -> app.update { it.copy(recEncoder = v) } }
    }
    Section("کیفیتِ فایل") {
        Label("اندازه")
        Seg(listOf(0 to "همان تصویر", 1440 to "1440p", 2160 to "4K"), if (s.recHeight == studio.height) 0 else s.recHeight, { v -> app.update { it.copy(recHeight = if (v == 0) studio.height else v) } }, enabled = !recording)
        Hint("1440p و 4K در یوتیوب کیفیتِ بهتری می‌گیرند (یوتیوب به ویدیوهای بزرگ‌تر کدکِ بهتر می‌دهد).")
        Label("کیفیت (مگابیت در ثانیه)")
        Seg(listOf(8000 to "8", 16000 to "16", 30000 to "30", 50000 to "50", 80000 to "80"), s.recKbps, { v -> app.update { it.copy(recKbps = v) } }, enabled = !recording)
        Hint(adviceRec(s.recHeight, studio.fps, s.recKbps), K.Accent)
    }
    Section("ضبط‌های بلند و عمودی") {
        Label("یک فایلِ تازه هر…")
        Seg(listOf(0 to "نه", 15 to "۱۵ دقیقه", 30 to "۳۰", 60 to "۶۰"), s.splitMinutes, { v -> app.update { it.copy(splitMinutes = v) } })
        Label("فایلِ عمودی (۹:۱۶) کنارِ فایلِ اصلی، از صحنهٔ عمودی")
        Seg(listOf(false to "نه", true to "بله"), s.recVertical, { v -> app.update { it.copy(recVertical = v) } }, enabled = !recording)
        if (s.recVertical && studio.verticalScene == null) Hint("اول یک صحنهٔ عمودی بساز (+ عمودی ۹:۱۶ در فهرستِ صحنه‌ها).", K.Warn)
    }
    Section("بافرِ بازپخش", subtitle = "چند ثانیهٔ آخر همیشه آماده است؛ F11 یا Ctrl+Alt+S آن را فایل می‌کند.") {
        Seg(listOf(15 to "۱۵ ث", 30 to "۳۰ ث", 60 to "۶۰ ث", 120 to "۲ دقیقه"), s.replaySeconds.takeIf { it > 0 } ?: 30, { v -> app.update { it.copy(replaySeconds = v) } }, enabled = app.replay == null)
    }
}

/** The studio itself: canvas, shortcuts, and where things are kept. */
@Composable
fun SettingsPanel(app: StudioApp, studio: Studio, onEdit: (Studio) -> Unit, busy: Boolean) {
    val s = app.settings
    Section("تصویرِ استودیو", subtitle = "همان که ضبط و پخش می‌شود.") {
        Label("اندازه")
        Seg(listOf((1920 to 1080) to "1080p", (2560 to 1440) to "1440p", (1280 to 720) to "720p", (1080 to 1920) to "عمودی"),
            studio.width to studio.height, { (w, h) -> onEdit(studio.resized(w, h)) }, enabled = !busy)
        Label("فریم در ثانیه")
        Seg(listOf(30 to "30", 60 to "60"), studio.fps, { onEdit(studio.copy(fps = it)) }, enabled = !busy)
        if (busy) Hint("حینِ ضبط یا پخش اندازه و فریم ثابت می‌مانند تا تصویر وسطِ کار جابه‌جا نشود.")
    }
    Section("اسپیکر یا هدفون", subtitle = "جایی که «🎧 گوش دادن» صدای خروجی را پخش می‌کند.") {
        val outs = remember { MicCapture.outputs() }
        Btn("پیش‌فرضِ سیستم", { app.update { it.copy(monitorDevice = "") } }, Modifier.fillMaxWidth().padding(bottom = 4.dp), on = s.monitorDevice.isBlank(), height = 28.dp)
        for (o in outs) Btn(o, { app.update { it.copy(monitorDevice = o) } }, Modifier.fillMaxWidth().padding(bottom = 4.dp), on = s.monitorDevice == o, height = 28.dp)
        Hint("صدای خودِ کامپیوتر هیچ‌وقت دوباره در گوش دادن پخش نمی‌شود، پس پژواک ساخته نمی‌شود.")
    }
    Section("میان‌بُرهای سراسری", subtitle = "حتی وقتی بازی یا پنجرهٔ دیگری جلوست.") {
        Seg(listOf(true to "روشن", false to "خاموش"), s.globalKeys, { v -> app.update { it.copy(globalKeys = v) } })
        GlobalKeys.error?.takeIf { s.globalKeys }?.let { Hint(it, K.Live) }
        Spacer(Modifier.height(6.dp))
        for ((k, v) in listOf("Ctrl+Alt+R" to "ضبط / پایان", "Ctrl+Alt+P" to "مکث", "Ctrl+Alt+L" to "پخشِ زنده", "Ctrl+Alt+S" to "ذخیرهٔ بازپخش", "Ctrl+Alt+K" to "عکس", "Ctrl+Alt+M" to "میکروفون قطع / وصل", "Ctrl+Alt+W" to "وب‌کم خاموش / روشن", "Ctrl+Alt+1…9" to "صحنه"))
            KeyRow(k, v)
    }
    Section("میان‌بُرهای داخلِ برنامه") {
        for ((k, v) in listOf("F9" to "ضبط", "F8" to "مکث", "F10" to "پخش", "F11" to "ذخیرهٔ بازپخش", "F12" to "عکس", "Ctrl+M" to "میکروفون قطع / وصل", "Ctrl+1…9" to "صحنه",
            "Ctrl+Z / Ctrl+Y" to "برگرداندن / دوباره", "Ctrl+D" to "تکثیرِ لایه", "Ctrl+C / Ctrl+V" to "کپی / چسباندن", "Delete" to "حذفِ لایه", "جهت‌ها (+Shift)" to "جابه‌جایی ۱ (۱۰) پیکسل"))
            KeyRow(k, v)
    }
    Section("فایل‌ها") {
        KeyRow("ضبط‌ها و عکس‌ها", com.vil3ntec.rawrec.desktop.AppPaths.videos.absolutePath)
        KeyRow("تنظیمات", com.vil3ntec.rawrec.desktop.AppPaths.data.absolutePath)
        Hint("کلیدهای پخش رمزگذاری‌شده فقط روی همین کامپیوتر می‌مانند.")
    }
}

@Composable
private fun KeyRow(key: String, what: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        T(what, 12, K.Text, modifier = Modifier.weight(1f), maxLines = 2)
        Box(Modifier.clip(RoundedCornerShape(5.dp)).background(K.Bg).border(1.dp, K.Line, RoundedCornerShape(5.dp)).padding(horizontal = 6.dp, vertical = 2.dp)) {
            T(key, 11, K.Dim, maxLines = 1)
        }
    }
}

private fun adviceRec(h: Int, fps: Int, kbps: Int): String {
    val need = when { h >= 2160 -> 45000; h >= 1440 -> 24000; else -> 12000 } * (if (fps >= 60) 1.5 else 1.0)
    return if (kbps >= need) "برای ${h}p${fps} کافی است: بی‌بلوک و بی‌شطرنجی." else "برای ${h}p${fps} دست‌کم ${(need / 1000).toInt()} مگابیت بگذار تا تصویرِ پرحرکت بلوکی نشود."
}

@Composable
fun EncoderPick(list: List<Encoders.Encoder>?, chosen: String, family: Encoders.Family?, enabled: Boolean, onPick: (String) -> Unit) {
    T("انکودر (کارتِ گرافیکِ همین کامپیوتر اول)", 11, K.Dim)
    Spacer(Modifier.height(4.dp))
    if (list == null) { T("در حالِ شناختنِ انکودرها…", 12, K.Faint); return }
    val l = list.filter { family == null || it.family == family }
    val cur = l.firstOrNull { it.name == chosen } ?: l.firstOrNull()
    Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
        for (e in l) Btn(e.label + if (e.hardware) "  • کارتِ گرافیک" else "  • پردازنده", { onPick(e.name) }, Modifier.fillMaxWidth(), on = e == cur, enabled = enabled, height = 28.dp)
    }
}

@Composable
fun LivePanel(app: StudioApp, encoders: List<Encoders.Encoder>?, onAir: Boolean) {
    val s = app.settings
    var editing by remember { mutableStateOf<Destination?>(null) }
    var keyText by remember { mutableStateOf("") }
    var vcMsg by remember { mutableStateOf<String?>(null) }
    Section("پلتفرم‌ها", subtitle = "همه با هم: یوتیوب، توییچ، کیک یا هر سرورِ RTMP — افقی یا عمودی (شورت).", trailing = {
        Btn("+ پلتفرم", {
            val d = Destination(Studio.newId(), Platform.YOUTUBE, "", Destination.defaultUrl(Platform.YOUTUBE), Secrets.seal(""))
            editing = d; keyText = ""
        }, height = 24.dp, enabled = !onAir)
    }) {
        if (s.dests.isEmpty() && editing == null) T("هنوز پلتفرمی نیست — «+ پلتفرم» را بزن و کلیدِ پخش را بگذار.", 12, K.Dim)
        val per = app.live?.perDest; val vPer = app.vLive?.perDest
        val ready = s.dests.filter { it.enabled && it.url.isNotBlank() && it.key.isNotBlank() }
        for ((i, d) in s.dests.withIndex()) {
            val stt = (if (d.vertical) vPer?.getOrNull(ready.filter { it.vertical }.indexOf(d)) else per?.getOrNull(ready.filter { !it.vertical }.indexOf(d)))?.status
            Row(Modifier.fillMaxWidth().padding(bottom = 4.dp).clip(RoundedCornerShape(6.dp)).background(K.Raised).border(1.dp, K.Line, RoundedCornerShape(6.dp)).padding(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(Color(d.platform.color)))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    T(d.name.ifBlank { d.platform.label } + if (d.vertical) "  • عمودی ۹:۱۶" else "", 13, if (d.enabled) K.Text else K.Faint, maxLines = 1)
                    T(if (stt != null) destState(stt) else "کلید: ${d.keyHint}", 11, if (stt?.state == RtmpSink.State.LIVE) K.Good else K.Dim, maxLines = 1)
                }
                Btn(if (d.enabled) "روشن" else "خاموش", { app.update { it.copy(dests = it.dests.map { x -> if (x.id == d.id) x.copy(enabled = !x.enabled) else x }) } }, on = d.enabled, height = 24.dp, enabled = !onAir)
                Spacer(Modifier.width(4.dp))
                Btn("✎", { editing = d; keyText = "" }, height = 24.dp, enabled = !onAir)
            }
        }
        editing?.let { d ->
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(K.Bg).border(1.dp, K.Accent, RoundedCornerShape(8.dp)).padding(8.dp),
                verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Seg(listOf(Platform.YOUTUBE to "YouTube", Platform.TWITCH to "Twitch", Platform.KICK to "Kick", Platform.TEST to "دیگر"), d.platform,
                    { p -> editing = d.copy(platform = p, url = Destination.defaultUrl(p)) })
                Field(d.name, { editing = d.copy(name = it) }, Modifier.fillMaxWidth(), hint = "نام (دلخواه)")
                Seg(listOf(false to "تصویرِ اصلی (افقی)", true to "تصویرِ عمودی ۹:۱۶ (شورت)"), d.vertical, { v -> editing = d.copy(vertical = v) })
                Field(d.url, { editing = d.copy(url = it.trim()) }, Modifier.fillMaxWidth(), hint = "نشانیِ سرور (rtmp:// یا rtmps://)", ltr = true)
                Field(keyText, { keyText = it.trim() }, Modifier.fillMaxWidth(), hint = if (d.key.isBlank()) "کلیدِ پخش (Stream key)" else "کلیدِ فعلی: ${d.keyHint} — برای عوض کردن بنویس", ltr = true, password = true)
                T("کلید رمزگذاری‌شده روی همین کامپیوتر می‌ماند و هیچ‌جا کامل نشان داده نمی‌شود.", 11, K.Faint)
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Btn("ذخیره", {
                        val nd = if (keyText.isNotBlank()) d.copy(keyEnc = Secrets.seal(keyText)) else d
                        app.update { st -> st.copy(dests = if (st.dests.any { it.id == nd.id }) st.dests.map { if (it.id == nd.id) nd else it } else st.dests + nd) }
                        editing = null; keyText = ""
                    }, Modifier.weight(1f), on = true)
                    Btn("حذف", { app.update { st -> st.copy(dests = st.dests.filter { it.id != d.id }) }; editing = null }, Modifier.weight(1f))
                    Btn("انصراف", { editing = null; keyText = "" }, Modifier.weight(1f))
                }
            }
            Spacer(Modifier.height(6.dp))
        }
    }
    Section("کیفیتِ پخش", subtitle = "اگر اینترنت نکشد خودکار پایین می‌آید و بعد دوباره بالا می‌رود؛ پخش قطع نمی‌شود.") {
        EncoderPick(encoders, s.liveEncoder, Encoders.Family.H264, enabled = !onAir) { v -> app.update { it.copy(liveEncoder = v) } }
        Label("بیشترین کیفیت (مگابیت در ثانیه)")
        Seg(listOf(3000 to "3", 4500 to "4.5", 6000 to "6", 8000 to "8", 12000 to "12"), s.liveKbps, { v -> app.update { it.copy(liveKbps = v) } }, enabled = !onAir)
        Hint("یوتیوب 1080p60: ۶ تا ۱۲؛ توییچ: حداکثر ۶ تا ۸.")
        if (s.dests.any { it.vertical }) {
            Label("کیفیتِ پخشِ عمودی (مگابیت)")
            Seg(listOf(3000 to "3", 4500 to "4.5", 6000 to "6", 8000 to "8"), s.vKbps, { v -> app.update { it.copy(vKbps = v) } }, enabled = !onAir)
        }
    }
    Section("دوربینِ مجازی", subtitle = "تصویرِ استودیو به‌عنوانِ دوربین در Zoom، Meet، Discord و مرورگر.") {
        val vc = app.vcam
        Btn(if (vc != null) "خاموش کن" else "روشن کن", { if (vc != null) app.stopVirtualCamera() else app.startVirtualCamera()?.let { vcMsg = it } },
            Modifier.fillMaxWidth(), on = vc != null, height = 32.dp, bold = true)
        when {
            vc?.error != null -> Hint(vc.error!!, K.Live)
            vc != null && vc.watched -> Hint("برنامه‌ای آن را نشان می‌دهد.", K.Good)
            vc != null -> Hint("در برنامهٔ دیگر دوربینِ «${VirtualCamera.NAME}» را انتخاب کن.")
            vcMsg != null -> Hint(vcMsg!!, K.Warn)
        }
    }
}

fun destState(s: RtmpSink.Status): String = when (s.state) {
    RtmpSink.State.CONNECTING -> "در حالِ وصل شدن…"
    RtmpSink.State.LIVE -> "روی آنتن • ${s.kbps / 1000.0} مگابیت • ${s.fps} فریم" + if (s.lagMs > 500) " • ${s.lagMs / 1000.0}ث عقب" else ""
    RtmpSink.State.RECONNECTING -> "اتصال دوباره… (${s.reconnects})"
    RtmpSink.State.FAILED -> "نشد: ${s.error ?: ""}"
    RtmpSink.State.ENDED -> "پایان"
}

/** The sound: each input with its meter, volume, mute and treatment; files' own sound; listening; the mix's meter. */
@Composable
fun MixerBar(app: StudioApp, tick: Int) {
    @Suppress("UNUSED_VARIABLE") val refresh = tick
    val s = app.settings
    val devs = remember { MicCapture.devices() }
    Column(Modifier.fillMaxWidth().background(K.Panel).padding(horizontal = 12.dp, vertical = 6.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalAlignment = Alignment.CenterVertically) {
            T("صدا", 12, K.Dim, bold = true)
            Channel("صدای گوشی", app.engine.mixer.input("phone"), s.phoneGain, s.phoneFx, tick, Modifier.weight(1f), null, emptyList(), {},
                { g -> app.update { it.copy(phoneGain = g) } }) { f -> app.update { it.copy(phoneFx = f) } }
            Channel("میکروفون", app.engine.mixer.input("mic"), s.micGain, s.micFx, tick, Modifier.weight(1f), s.mic, devs,
                { d -> app.update { it.copy(mic = d) } }, { g -> app.update { it.copy(micGain = g) } }) { f -> app.update { it.copy(micFx = f) } }
            Channel("صدای کامپیوتر", app.engine.mixer.input("desktop"), s.desktopGain, s.desktopFx, tick, Modifier.weight(1f), s.desktopDevice, listOf(SystemSound.NAME) + devs,
                { d -> app.update { it.copy(desktopDevice = d) } }, { g -> app.update { it.copy(desktopGain = g) } }) { f -> app.update { it.copy(desktopFx = f) } }
            Column(Modifier.width(170.dp)) {
                Meter("خروجی", app.engine.mixer.level, tick, Modifier.fillMaxWidth())
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    Btn("🎧 گوش دادن", { app.update { it.copy(monitor = !it.monitor) } }, on = s.monitor, height = 22.dp)
                    Btn("محدودکننده", { app.update { it.copy(limiter = !it.limiter) } }, on = s.limiter, height = 22.dp)
                }
            }
        }
        // each video file's own sound, as its own channel
        val media = app.engine.mixer.inputs.keys.filter { it.startsWith("media-") }.sorted()
        if (media.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(top = 4.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            for (id in media) {
                val inp = app.engine.mixer.input(id)
                val name = app.studio.source(id.removePrefix("media-"))?.name ?: "ویدیو"
                Row(Modifier.width(260.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Btn(if (inp.muted) "بی‌صدا" else "🔊", { inp.muted = !inp.muted }, on = inp.muted, tint = K.Live, height = 22.dp)
                    Column(Modifier.weight(1f)) { T(name, 11, maxLines = 1); Meter(null, inp.level, tick, Modifier.fillMaxWidth()) }
                    androidx.compose.material3.Slider(inp.gain, { inp.gain = it }, valueRange = 0f..2f, modifier = Modifier.width(90.dp).height(18.dp),
                        colors = androidx.compose.material3.SliderDefaults.colors(thumbColor = K.Accent, activeTrackColor = K.Accent, inactiveTrackColor = K.Line))
                }
            }
        }
        (app.micError ?: app.desktopError)?.let { T("صدا: $it", 11, K.Live) }
    }
}

@Composable
private fun Channel(name: String, input: AudioInput, gain: Float, fx: AudioFx, tick: Int, modifier: Modifier, device: String?, devices: List<String>,
                    onDevice: (String) -> Unit, onGain: (Float) -> Unit, onFx: (AudioFx) -> Unit) {
    var menu by remember { mutableStateOf(false) }
    var fxMenu by remember { mutableStateOf(false) }
    Row(modifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Btn(if (input.muted) "بی‌صدا" else "🔊", { input.muted = !input.muted }, on = input.muted, tint = K.Live, height = 26.dp)
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                T(name, 12, modifier = Modifier.weight(1f), maxLines = 1)
                if (device != null) Box {
                    T(if (device.isBlank()) "انتخاب ▾" else device.take(18) + " ▾", 11, K.Accent, modifier = Modifier.clickable { menu = true })
                    androidx.compose.material3.DropdownMenu(menu, { menu = false }, Modifier.background(K.Raised)) {
                        androidx.compose.material3.DropdownMenuItem({ T("خاموش") }, { onDevice(""); menu = false })
                        for (d in devices) androidx.compose.material3.DropdownMenuItem({ T(d) }, { onDevice(d); menu = false })
                        if (name == "صدای کامپیوتر") androidx.compose.material3.DropdownMenuItem({ T("ویندوز: در تنظیماتِ صدا «Stereo Mix» را روشن کن تا این‌جا بیاید", 11, K.Faint) }, { menu = false })
                    }
                }
                Spacer(Modifier.width(6.dp))
                Box {
                    val any = fx.denoise || fx.gate || fx.comp || fx.delayMs > 0
                    T("جلوه ▾", 11, if (any) K.Accent else K.Dim, modifier = Modifier.clickable { fxMenu = true })
                    androidx.compose.material3.DropdownMenu(fxMenu, { fxMenu = false }, Modifier.background(K.Raised).width(300.dp)) {
                        Column(Modifier.padding(10.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) { T("حذفِ نویز با هوشِ مصنوعی (RNNoise)", 12, modifier = Modifier.weight(1f)); Seg(listOf(true to "روشن", false to "خاموش"), fx.denoise, { onFx(fx.copy(denoise = it)) }, Modifier.width(110.dp)) }
                            if (fx.denoise) SliderRow("قدرت", fx.denoisePct.toFloat(), 10f..100f, "${fx.denoisePct}٪") { onFx(fx.copy(denoisePct = it.toInt())) }
                            Row(verticalAlignment = Alignment.CenterVertically) { T("دروازهٔ نویز (سکوت وقتی حرف نمی‌زنی)", 12, modifier = Modifier.weight(1f)); Seg(listOf(true to "روشن", false to "خاموش"), fx.gate, { onFx(fx.copy(gate = it)) }, Modifier.width(110.dp)) }
                            if (fx.gate) SliderRow("آستانه", fx.gateDb, -70f..-10f, "${fx.gateDb.toInt()} dB") { onFx(fx.copy(gateDb = it)) }
                            Row(verticalAlignment = Alignment.CenterVertically) { T("کمپرسور (صدای یکدست)", 12, modifier = Modifier.weight(1f)); Seg(listOf(true to "روشن", false to "خاموش"), fx.comp, { onFx(fx.copy(comp = it)) }, Modifier.width(110.dp)) }
                            if (fx.comp) {
                                SliderRow("آستانه", fx.compDb, -40f..0f, "${fx.compDb.toInt()} dB") { onFx(fx.copy(compDb = it)) }
                                SliderRow("نسبت", fx.ratio, 1.5f..10f, "%.1f:1".format(fx.ratio)) { onFx(fx.copy(ratio = it)) }
                            }
                            SliderRow("تأخیر", fx.delayMs.toFloat(), 0f..1000f, "${fx.delayMs} ms") { onFx(fx.copy(delayMs = (it / 10).toInt() * 10)) }
                            T("تأخیر: وقتی صدا جلوتر از تصویر است (مثلاً وب‌کم کُند است)، صدا را عقب ببر.", 11, K.Faint)
                        }
                    }
                }
                Spacer(Modifier.width(6.dp)); T("${(gain * 100).toInt()}٪", 11, K.Dim)
            }
            Meter(null, input.level, tick, Modifier.fillMaxWidth())
            androidx.compose.material3.Slider(gain, onGain, valueRange = 0f..2f, modifier = Modifier.height(18.dp),
                colors = androidx.compose.material3.SliderDefaults.colors(thumbColor = K.Accent, activeTrackColor = K.Accent, inactiveTrackColor = K.Line))
        }
    }
}

@Composable
private fun Meter(label: String?, level: Float, tick: Int, modifier: Modifier) {
    val db = AudioMixer.db(level).coerceIn(-60f, 0f)
    val f = (db + 60f) / 60f
    Column(modifier) {
        if (label != null) T(label, 11, K.Dim)
        Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(3.dp)).background(K.Bg)) {
            Box(Modifier.fillMaxWidth(f).fillMaxHeight().background(if (db > -3) K.Live else if (db > -12) K.Amber else K.Good))
        }
    }
}
