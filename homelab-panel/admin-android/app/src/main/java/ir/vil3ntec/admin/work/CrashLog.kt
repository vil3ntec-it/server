package ir.vil3ntec.admin.work

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Process
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.system.exitProcess

/**
 *  دفترچهٔ کِرَش — «چرا برنامه پرید بیرون؟»
 *
 *  ⚠️ چرا لازم شد: برنامه روی گوشی افتاد و تنها چیزی که دیده شد یک کادرِ
 *  «has stopped» بود. نه دلیلی، نه خطی، نه ردی. برای فهمیدنش باید گوشی را
 *  به کامپیوتر وصل کرد و logcat گرفت — کاری که صاحبِ برنامه قرار نیست بکند.
 *
 *  حالا خودِ برنامه آخرین کِرَشش را می‌نویسد و دفعهٔ بعد که باز شود، در
 *  خانه نشانش می‌دهد با دکمهٔ کپی. یک بار کپی و فرستادن، به‌جای یک ساعت
 *  حدس زدن.
 *
 *  ⚠️ جایی بیرون نمی‌رود: فقط در حافظهٔ خودِ برنامه می‌ماند تا کاربر
 *  خودش تصمیم بگیرد بفرستدش یا نه.
 */
object CrashLog {

  private const val FILE = "villain-admin-crash"
  private const val KEY_TEXT = "last_crash"
  private const val KEY_AT = "last_crash_at"
  private const val KEY_RESTART = "last_restart_at"

  /** به MainActivity می‌گوید «این بار بعدِ یک کِرَش باز شده‌ای» */
  const val EXTRA_CRASHED = "crashed"

  /**
   * از این به بعد هر خطای نگرفته، پیش از بسته شدنِ برنامه نوشته می‌شود.
   *
   * ⚠️ کارِ هندلرِ قبلی را نمی‌خوریم: بعد از نوشتن، همان را صدا می‌زنیم تا
   * اندروید کارِ همیشگی‌اش را بکند. وگرنه برنامه به‌جای بسته شدن، یخ می‌زند.
   */
  fun install(context: Context) {
    val app = context.applicationContext
    val previous = Thread.getDefaultUncaughtExceptionHandler()

    Thread.setDefaultUncaughtExceptionHandler { thread, error ->
      runCatching { write(app, thread, error) }

      /*
       *  ⚠️ به‌جای انداختنِ کاربر بیرون، برنامه را برمی‌گردانیم.
       *
       *  کادرِ «has stopped» بدترین چیزی است که می‌شود نشان داد: کاربر
       *  وسطِ کارش روی صفحهٔ خانهٔ گوشی می‌افتد، هیچ نمی‌فهمد چه شد، و
       *  هیچ ردی هم نمی‌ماند. حالا برنامه دوباره باز می‌شود و همان
       *  خطا را با دکمهٔ کپی نشان می‌دهد.
       *
       *  ⚠️ و محافظِ حلقه: اگر دو کِرَش در ده ثانیه پشتِ هم بیایند، یعنی
       *  خودِ راه‌اندازی خراب است و باز کردنِ دوباره فقط یک چرخهٔ بی‌پایان
       *  می‌سازد. آن‌جا کارِ همیشگیِ اندروید انجام می‌شود.
       */
      val spinning = runCatching { restartedRecently(app) }.getOrDefault(true)
      if (spinning || !relaunch(app)) {
        previous?.uncaughtException(thread, error)
        return@setDefaultUncaughtExceptionHandler
      }

      Process.killProcess(Process.myPid())
      exitProcess(10)
    }
  }

  /** آیا همین چند ثانیهٔ پیش هم یک بار برگشته‌ایم؟ */
  private fun restartedRecently(context: Context): Boolean {
    val prefs = context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
    val last = prefs.getLong(KEY_RESTART, 0L)
    val now = System.currentTimeMillis()
    prefs.edit().putLong(KEY_RESTART, now).apply()
    return now - last < 10_000
  }

  /** باز کردنِ دوبارهٔ برنامه روی صفحه‌ای که خطا را نشان می‌دهد */
  private fun relaunch(context: Context): Boolean = runCatching {
    val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?: return@runCatching false
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    intent.putExtra(EXTRA_CRASHED, true)
    context.startActivity(intent)
    true
  }.getOrDefault(false)

  private fun write(context: Context, thread: Thread, error: Throwable) {
    val trace = StringWriter().also { error.printStackTrace(PrintWriter(it)) }.toString()
    val stamp = SimpleDateFormat("yyyy/MM/dd HH:mm", Locale.US).format(Date())
    val text = buildString {
      append("زمان: ").append(stamp).append('\n')
      append("گوشی: ").append(Build.MANUFACTURER).append(' ').append(Build.MODEL)
      append("  ·  اندروید ").append(Build.VERSION.SDK_INT).append('\n')
      append("نخ: ").append(thread.name).append('\n')
      append('\n')
      append(trace.take(4_000))
    }
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
      .putString(KEY_TEXT, text)
      .putLong(KEY_AT, System.currentTimeMillis())
      .apply()
  }

  /** آخرین کِرَش، یا null اگر برنامه تا حالا نیفتاده */
  fun last(context: Context): String? =
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE)
      .getString(KEY_TEXT, null)
      ?.takeIf { it.isNotBlank() }

  fun clear(context: Context) {
    context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().clear().apply()
  }
}
