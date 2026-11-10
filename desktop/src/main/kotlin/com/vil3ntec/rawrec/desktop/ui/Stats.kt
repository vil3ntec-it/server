package com.vil3ntec.rawrec.desktop.ui

import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.vil3ntec.rawrec.desktop.AppPaths
import com.vil3ntec.rawrec.desktop.studio.*
import java.lang.management.ManagementFactory

/** As OBS's «Stats» dock: what the computer and every output are doing, once a second. */
@Composable
fun StatsPanel(app: StudioApp, tick: Int) {
    @Suppress("UNUSED_VARIABLE") val refresh = tick
    // the CPU figures come from the JDK's own management module; without it the rest still shows
    val cpu: Pair<Double, Double>? = try {
        (ManagementFactory.getOperatingSystemMXBean() as? com.sun.management.OperatingSystemMXBean)?.let { it.processCpuLoad to it.cpuLoad }
    } catch (_: Throwable) { null }
    val rt = Runtime.getRuntime()
    val e = app.engine
    val st = app.studio
    Section("کامپیوتر") {
        Row2("پردازنده (این برنامه / کل)", cpu?.let { (p, a) -> "${(p * 100).toInt()}٪ / ${(a * 100).toInt()}٪" } ?: "—")
        Row2("حافظه", "${(rt.totalMemory() - rt.freeMemory()) / 1_048_576} از ${rt.maxMemory() / 1_048_576} مگابایت")
        Row2("جای خالیِ دیسکِ ضبط‌ها", "${AppPaths.videos.usableSpace / 1_073_741_824} گیگابایت")
    }
    HLine()
    Section("تصویر") {
        Row2("فریم در ثانیه", "${e.fps} از ${st.fps}", if (e.fps >= st.fps - 2) K.Good else K.Warn)
        Row2("زمانِ ساختنِ هر فریم", "%.1f ms (سقف %.1f)".format(e.drawMs, 1000.0 / st.fps), if (e.drawMs < 1000.0 / st.fps * 0.7) K.Good else K.Warn)
        Row2("فریم‌های جامانده (کامپیوتر کُند بود)", "${e.late}", if (e.late == 0L) K.Good else K.Warn)
        Row2("اندازه", "${st.width}×${st.height}")
    }
    HLine()
    Section("ضبط") {
        val r = app.recording
        if (r == null) T("ضبط روشن نیست.", 12, K.Faint)
        else {
            Row2("وضعیت", if (r.paused) "مکث" else "در حالِ ضبط")
            Row2("حجم", "${r.bytes / 1_048_576} مگابایت")
            Row2("فریم‌های جامانده (انکودر کُند بود)", "${r.dropped}", if (r.dropped == 0L) K.Good else K.Warn)
        }
        app.replay?.let { Row2("بافرِ بازپخش", "%.0f از %d ثانیه".format(it.heldSeconds, it.seconds)) }
    }
    HLine()
    Section("پخش") {
        val l = app.live
        if (l == null) T("پخش روشن نیست.", 12, K.Faint)
        else {
            Row2("فریم‌های جامانده پیش از ارسال", "${l.dropped}", if (l.dropped == 0L) K.Good else K.Warn)
            for (d in l.perDest) {
                val s = d.status
                T(d.name, 12, K.Text, bold = true, modifier = Modifier.padding(top = 4.dp))
                if (s == null) T("…", 12, K.Faint) else {
                    Row2("وضعیت", destState(s), if (s.state == com.vil3ntec.rawrec.RtmpSink.State.LIVE) K.Good else K.Warn)
                    Row2("سرعت / هدف", "${s.kbps} / ${s.targetKbps} کیلوبیت")
                    Row2("عقب‌ماندگی", "${s.lagMs} ms", if (s.lagMs < 1000) K.Good else K.Warn)
                    Row2("فریمِ رهاشده / اتصالِ دوباره", "${s.dropped} / ${s.reconnects}", if (s.dropped == 0) K.Good else K.Warn)
                }
            }
        }
    }
}

@Composable
private fun Row2(a: String, b: String, c: androidx.compose.ui.graphics.Color = K.Text) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) { T(a, 12, K.Dim, modifier = Modifier.weight(1f)); T(b, 12, c) }
}
