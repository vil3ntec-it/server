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

@Composable
fun PhonePanel(app: StudioApp, devices: List<Adb.Device>, st: Session.State, locked: Boolean) {
    val s = app.settings
    var serial by remember { mutableStateOf<String?>(null) }
    if (serial == null || devices.none { it.serial == serial }) serial = devices.firstOrNull { it.usable }?.serial
    val live = st.phase != Session.Phase.IDLE
    Section("گوشی با کابل") {
        if (app.adb == null) T("adb پیدا نشد؛ برنامه را دوباره نصب کن.", 12, K.Live)
        else if (devices.isEmpty()) T("گوشی را با کابل وصل کن و در «گزینه‌های توسعه‌دهنده» «اشکال‌زدایی USB» را روشن کن.", 12, K.Dim)
        for (d in devices) {
            val on = d.serial == serial
            Row(Modifier.fillMaxWidth().padding(bottom = 4.dp).clip(RoundedCornerShape(6.dp)).background(if (on) K.AccentDim else K.Raised)
                .border(1.dp, if (on) K.Accent else K.Line, RoundedCornerShape(6.dp)).clickable(enabled = d.usable && !live) { serial = d.serial }.padding(8.dp),
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
            Modifier.fillMaxWidth(), on = live, enabled = live || serial != null, height = 34.dp, bold = true)
        if (st.phase == Session.Phase.CONNECTING) T("در حالِ وصل شدن…", 12, K.Dim, modifier = Modifier.padding(top = 6.dp))
        if (st.phase == Session.Phase.LIVE) T("${st.device} • ${st.codec.uppercase()} ${st.width}×${st.height} • ${st.fps} فریم • ${"%.1f".format(st.mbps)} مگابیت", 12, K.Accent, modifier = Modifier.padding(top = 6.dp))
        st.error?.let { T(it, 12, K.Live, modifier = Modifier.padding(top = 6.dp)) }
    }
    HLine()
    Section("کیفیتِ گرفتن از گوشی") {
        T("گوشی خودش تصویر را می‌سازد و از کابل می‌فرستد؛ هر چه بیشتر، نزدیک‌تر به صفحهٔ گوشی. تغییرها از اتصالِ بعدی اثر دارند.", 11, K.Faint)
        Spacer(Modifier.height(6.dp))
        Seg(listOf("h265" to "HEVC", "h264" to "H.264", "av1" to "AV1"), s.phoneCodec, { v -> app.update { it.copy(phoneCodec = v) } }, enabled = !live)
        Spacer(Modifier.height(6.dp))
        Seg(listOf(20 to "20", 40 to "40", 60 to "60", 80 to "80", 100 to "100 Mb"), s.phoneMbps, { v -> app.update { it.copy(phoneMbps = v) } }, enabled = !live)
        Spacer(Modifier.height(6.dp))
        Seg(listOf(0 to "اصلی", 2560 to "1440p", 1920 to "1080p"), s.phoneSize, { v -> app.update { it.copy(phoneSize = v) } }, enabled = !live)
        Spacer(Modifier.height(6.dp))
        Seg(listOf(30 to "30", 60 to "60", 90 to "90", 120 to "120 فریم"), s.phoneFps, { v -> app.update { it.copy(phoneFps = v) } }, enabled = !live)
    }
}

@Composable
fun OutputPanel(app: StudioApp, encoders: List<Encoders.Encoder>?, studio: Studio, onEdit: (Studio) -> Unit, recording: Boolean, onAir: Boolean) {
    val s = app.settings
    val busy = recording || onAir
    Section("تصویرِ خروجی (برای ضبط و پخش)") {
        Seg(listOf((1920 to 1080) to "1080p افقی", (2560 to 1440) to "1440p افقی", (1080 to 1920) to "عمودی 1080×1920", (1280 to 720) to "720p"),
            studio.width to studio.height, { (w, h) -> onEdit(studio.resized(w, h)) }, enabled = !busy)
        Spacer(Modifier.height(6.dp))
        Seg(listOf(30 to "30 فریم", 60 to "60 فریم"), studio.fps, { onEdit(studio.copy(fps = it)) }, enabled = !busy)
        if (busy) T("حینِ ضبط یا پخش اندازه و فریم ثابت می‌مانند (تصویر هیچ‌وقت وسطِ کار کوچک یا جابه‌جا نمی‌شود).", 11, K.Faint, modifier = Modifier.padding(top = 4.dp))
    }
    HLine()
    Section("ضبط") {
        EncoderPick(encoders, s.recEncoder, null, enabled = !recording) { v -> app.update { it.copy(recEncoder = v) } }
        Spacer(Modifier.height(6.dp))
        T("اندازهٔ فایل", 11, K.Dim)
        Seg(listOf(0 to "همان تصویر", 1440 to "1440p", 2160 to "4K"), if (s.recHeight == studio.height) 0 else s.recHeight, { v -> app.update { it.copy(recHeight = if (v == 0) studio.height else v) } }, enabled = !recording)
        T("1440p و 4K در یوتیوب کیفیتِ بهتری می‌گیرند (یوتیوب به ویدیوهای بزرگ‌تر کدکِ بهتر می‌دهد).", 11, K.Faint, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.height(6.dp))
        T("کیفیت (مگابیت در ثانیه)", 11, K.Dim)
        Seg(listOf(8000 to "8", 16000 to "16", 30000 to "30", 50000 to "50", 80000 to "80"), s.recKbps, { v -> app.update { it.copy(recKbps = v) } }, enabled = !recording)
        T(adviceRec(s.recHeight, studio.fps, s.recKbps), 11, K.Accent, modifier = Modifier.padding(top = 4.dp))
        Spacer(Modifier.height(6.dp))
        T("تقسیمِ خودکارِ ضبط‌های بلند", 11, K.Dim)
        Seg(listOf(0 to "نه", 15 to "۱۵ دقیقه", 30 to "۳۰", 60 to "۶۰"), s.splitMinutes, { v -> app.update { it.copy(splitMinutes = v) } })
        Spacer(Modifier.height(6.dp))
        T("بافرِ بازپخش: چند ثانیهٔ آخر همیشه آماده است؛ F11 یا «ذخیرهٔ بازپخش» آن را فایل می‌کند", 11, K.Dim)
        Seg(listOf(15 to "۱۵ ث", 30 to "۳۰ ث", 60 to "۶۰ ث", 120 to "۲ دقیقه"), s.replaySeconds.takeIf { it > 0 } ?: 30, { v -> app.update { it.copy(replaySeconds = v) } }, enabled = app.replay == null)
        Spacer(Modifier.height(6.dp))
        T("میان‌بُرها: F9 ضبط • F8 مکث • F10 پخش • F11 ذخیرهٔ بازپخش • F12 عکس • Ctrl+1..9 صحنه • Ctrl+Z/Y برگرداندن • Ctrl+D تکثیر • Ctrl+C/V کپی • Delete حذف • جهت‌ها جابه‌جایی (با Shift ده‌تایی)", 11, K.Faint)
    }
    HLine()
    LivePanel(app, encoders, onAir)
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
    Section("پخشِ زنده — همهٔ پلتفرم‌ها با هم", trailing = {
        Btn("+ پلتفرم", {
            val d = Destination(Studio.newId(), Platform.YOUTUBE, "", Destination.defaultUrl(Platform.YOUTUBE), Secrets.seal(""))
            editing = d; keyText = ""
        }, height = 24.dp, enabled = !onAir)
    }) {
        if (s.dests.isEmpty() && editing == null) T("پلتفرمی اضافه نشده. یوتیوب، توییچ، کیک یا هر سرورِ RTMP — همه با هم.", 12, K.Faint)
        val per = app.live?.perDest
        for ((i, d) in s.dests.withIndex()) {
            val stt = per?.getOrNull(s.dests.filter { it.enabled && it.url.isNotBlank() && it.key.isNotBlank() }.indexOf(d))?.status
            Row(Modifier.fillMaxWidth().padding(bottom = 4.dp).clip(RoundedCornerShape(6.dp)).background(K.Raised).border(1.dp, K.Line, RoundedCornerShape(6.dp)).padding(8.dp),
                verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.size(10.dp).clip(RoundedCornerShape(3.dp)).background(Color(d.platform.color)))
                Spacer(Modifier.width(8.dp))
                Column(Modifier.weight(1f)) {
                    T(d.name.ifBlank { d.platform.label }, 13, if (d.enabled) K.Text else K.Faint, maxLines = 1)
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
        Spacer(Modifier.height(6.dp))
        EncoderPick(encoders, s.liveEncoder, Encoders.Family.H264, enabled = !onAir) { v -> app.update { it.copy(liveEncoder = v) } }
        Spacer(Modifier.height(6.dp))
        T("بیشترین کیفیت (مگابیت در ثانیه) — اگر اینترنت نکشد خودکار پایین می‌آید و دوباره بالا می‌رود", 11, K.Dim)
        Spacer(Modifier.height(4.dp))
        Seg(listOf(3000 to "3", 4500 to "4.5", 6000 to "6", 8000 to "8", 12000 to "12"), s.liveKbps, { v -> app.update { it.copy(liveKbps = v) } }, enabled = !onAir)
        T("یوتیوب 1080p60: ۶ تا ۱۲؛ توییچ: حداکثر ۶ تا ۸.", 11, K.Faint, modifier = Modifier.padding(top = 4.dp))
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
            Channel("صدای کامپیوتر", app.engine.mixer.input("desktop"), s.desktopGain, s.desktopFx, tick, Modifier.weight(1f), s.desktopDevice, devs,
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
