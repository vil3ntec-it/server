package com.vil3ntec.rawrec

import android.app.Application
import android.content.Context
import android.content.SharedPreferences
import android.net.Uri
import android.os.Build
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Installs the crash safety net before any activity or service starts. */
class RawRecApp : Application() {
    override fun onCreate() {
        super.onCreate()
        CrashLog.install(this)
        ActiveRec.recoverInterrupted(this)
    }
}

/**
 * Process-wide safety net: any uncaught exception is written to app files, and the next launch
 * shows it («دفعهٔ قبل برنامه بسته شد») with copy / share, so the owner can send it back.
 */
object CrashLog {
    private const val FILE = "last_crash.txt"

    fun install(ctx: Context) {
        val app = ctx.applicationContext
        val previous = Thread.getDefaultUncaughtExceptionHandler()
        Thread.setDefaultUncaughtExceptionHandler { t, e ->
            try { write(app, e, "thread ${t.name}") } catch (_: Throwable) {}
            // A recording in progress is finalized first, so its video is playable after the crash.
            try { RecordService.onProcessCrash(e) } catch (_: Throwable) {}
            previous?.uncaughtException(t, e)
        }
    }

    /** Also used for exceptions that were caught (e.g. the screen could not be built). */
    fun write(ctx: Context, e: Throwable, where: String, handled: Boolean = false) {
        val sw = StringWriter()
        e.printStackTrace(PrintWriter(sw))
        val text = buildString {
            append("RawRec ").append(BuildInfo.version(ctx)).append(if (handled) " error (app kept running)\n" else " crash\n")
            append(SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())).append(" • ").append(where).append('\n')
            append("Android ").append(Build.VERSION.RELEASE).append(" (API ").append(Build.VERSION.SDK_INT).append(") • ")
            append(Build.MANUFACTURER).append(' ').append(Build.MODEL).append(" • ").append(Locale.getDefault().toLanguageTag()).append('\n')
            append(sw.toString())
        }
        File(ctx.filesDir, FILE).writeText(text)
    }

    fun pending(ctx: Context): String? = try {
        File(ctx.filesDir, FILE).takeIf { it.exists() }?.readText()
    } catch (_: Throwable) { null }

    fun clear(ctx: Context) { try { File(ctx.filesDir, FILE).delete() } catch (_: Throwable) {} }
}

/**
 * A short diary of recordings (start settings, why each one ended, recoveries, notices), kept across
 * launches so the owner can copy it when a recording did something unexpected. Newest last.
 */
object RecLog {
    private const val FILE = "rec_log.txt"
    private const val MAX_CHARS = 16_000

    @Synchronized
    fun add(ctx: Context, line: String) {
        try {
            val f = File(ctx.filesDir, FILE)
            val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
            var text = (if (f.exists()) f.readText() else "") + stamp + "  " + line.replace('\n', ' ') + "\n"
            if (text.length > MAX_CHARS) text = text.substring(text.indexOf('\n', text.length - MAX_CHARS * 3 / 4) + 1)
            f.writeText(text)
        } catch (_: Throwable) {}
    }

    fun text(ctx: Context): String = try {
        File(ctx.filesDir, FILE).takeIf { it.exists() }?.readText() ?: ""
    } catch (_: Throwable) { "" }

    fun clear(ctx: Context) { try { File(ctx.filesDir, FILE).delete() } catch (_: Throwable) {} }
}

/**
 * Marks a recording in progress. MediaMuxer writes an MP4's index only when a part is closed, so if
 * the process is killed in the middle (low memory, «Stop» in Android's active-apps list) the open
 * part stays a hidden, unplayable file. The next start of the app finds the marker, removes those
 * leftovers (they can't be played and only take space; Android would delete them after a week) and
 * saves why the recording ended for the report.
 */
object ActiveRec {
    private const val FILE = "rec_active.txt"

    private fun file(ctx: Context) = File(ctx.filesDir, FILE)

    @Synchronized
    private fun append(ctx: Context, line: String) {
        try { file(ctx).appendText(line + "\n") } catch (_: Throwable) {}
    }

    @Synchronized
    fun begin(ctx: Context) {
        try { file(ctx).writeText("begin " + System.currentTimeMillis() + "\n") } catch (_: Throwable) {}
    }

    fun partOpened(ctx: Context, uri: Uri) = append(ctx, "open $uri")
    fun partClosed(ctx: Context, uri: Uri) = append(ctx, "done $uri")
    fun reason(ctx: Context, reason: StopReason) = append(ctx, "reason ${reason.name}")

    @Synchronized
    fun end(ctx: Context) { try { file(ctx).delete() } catch (_: Throwable) {} }

    /** Called once per process start, before any recording can begin. */
    fun recoverInterrupted(app: Context) {
        val lines: List<String>
        synchronized(this) {
            val f = file(app)
            if (!f.exists()) return
            lines = try { f.readLines() } catch (_: Throwable) { emptyList() }
            try { f.delete() } catch (_: Throwable) {}
        }
        val opened = LinkedHashSet<String>()
        val done = HashSet<String>()
        var reason: StopReason? = null
        for (l in lines) when {
            l.startsWith("open ") -> opened += l.substring(5)
            l.startsWith("done ") -> done += l.substring(5)
            l.startsWith("reason ") -> reason = StopReason.of(l.substring(7))
        }
        val leftovers = opened.filter { it !in done }
        val startedMs = System.currentTimeMillis()
        Thread {
            try {
                // 2.0: a part written by RawRec's own MP4 writer is finished from its journal and kept
                // (up to its last second); only one that can't be finished is removed.
                var recovered = 0
                for (u in leftovers) try {
                    val uri = Uri.parse(u)
                    if (MediaStoreSink.recover(app, uri)) recovered++
                    else app.contentResolver.delete(uri, null, null)
                } catch (_: Throwable) {}
                // Journals nobody needs any more (never one of a recording started since this process began).
                try {
                    app.filesDir.listFiles { f -> f.name.startsWith("rec-") && f.name.endsWith(".rrj") && f.lastModified() < startedMs - 60_000 }
                        ?.forEach { it.delete() }
                } catch (_: Throwable) {}
                // The crash handler already saved its own reason; otherwise the process was killed.
                if (reason == null) {
                    val ctx = AppLang.wrap(app)
                    RecordService.saveStop(ctx, StopReason.PROCESS_DIED, null, commit = true)
                    val report = ctx.getString(R.string.rep_title_fmt, BuildInfo.version(ctx)) + "\n" +
                        ctx.getString(R.string.eng_rep_reason_fmt, ctx.getString(StopReason.PROCESS_DIED.text)) + "\n" +
                        ctx.getString(R.string.eng_rep_saved_parts_fmt, done.size + recovered)
                    ctx.getSharedPreferences(RecordService.PREFS, Context.MODE_PRIVATE).edit()
                        .putString(RecordService.K_LAST_REPORT, report)
                        .putString(RecordService.K_LAST_ERROR, ctx.getString(StopReason.PROCESS_DIED.text))
                        .putBoolean(RecordService.K_LAST_IS_TEST, false)
                        .putBoolean(RecordService.K_REPORT_UNSEEN, true)
                        .commit()
                }
                RecLog.add(app, "interrupted recording found: ${leftovers.size} unfinished part(s), $recovered finished from the journal, ${done.size} saved")
            } catch (_: Throwable) {}
        }.start()
    }
}

/**
 * SharedPreferences reads that survive a type change between versions (a key written as Int by an
 * older build and read as Boolean now would throw ClassCastException): the bad key is reset.
 */
object SafePrefs {
    private inline fun <T> read(p: SharedPreferences, key: String, def: T, get: () -> T): T = try { get() } catch (_: ClassCastException) {
        p.edit().remove(key).apply(); def
    }
    fun int(p: SharedPreferences, key: String, def: Int) = read(p, key, def) { p.getInt(key, def) }
    fun long(p: SharedPreferences, key: String, def: Long) = read(p, key, def) { p.getLong(key, def) }
    fun float(p: SharedPreferences, key: String, def: Float) = read(p, key, def) { p.getFloat(key, def) }
    fun bool(p: SharedPreferences, key: String, def: Boolean) = read(p, key, def) { p.getBoolean(key, def) }
    fun str(p: SharedPreferences, key: String): String = read(p, key, "") { p.getString(key, "") ?: "" }
}
