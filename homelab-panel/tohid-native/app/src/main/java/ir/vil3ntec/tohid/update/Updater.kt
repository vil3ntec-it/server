package ir.vil3ntec.tohid.update

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 *  به‌روزرسانی از GitHub — بدونِ Android Studio، بدونِ فروشگاه.
 *
 *  آخرین Release مخزن خوانده می‌شود، فایلِ APK آن گرفته می‌شود و به خودِ
 *  اندروید داده می‌شود تا نصبش کند.
 *
 *  دو چیز که عمداً این‌طوری‌اند:
 *    • نسخهٔ پیش‌نمایش هم دیده می‌شود. /releases/latest نسخه‌های پیش‌نمایش را
 *      نشان نمی‌دهد و اگر مخزنی فقط همان‌ها را داشته باشد، به‌روزرسانی هرگز
 *      چیزی پیدا نمی‌کرد.
 *    • مقایسه با شمارهٔ نسخه است، نه با نام فایل — پس نصبِ نسخهٔ عقب‌تر
 *      پیشنهاد نمی‌شود.
 */
object Updater {

  data class Release(
    val version: String,
    val notes: String,
    val apkUrl: String,
    val size: Long,
  )

  /** owner/repo — از تنظیمات می‌آید تا هر وقت خواستی عوضش کنی */
  suspend fun check(repo: String, currentVersion: String): Result<Release?> =
    withContext(Dispatchers.IO) {
      runCatching {
        val slug = repo.trim().trim('/')
        require(Regex("^[\\w.-]+/[\\w.-]+$").matches(slug)) { "آدرس مخزن درست نیست" }

        val body = get("https://api.github.com/repos/$slug/releases?per_page=10")
        val list = org.json.JSONArray(body)
        var best: Release? = null

        for (i in 0 until list.length()) {
          val r = list.getJSONObject(i)
          if (r.optBoolean("draft")) continue
          val assets = r.getJSONArray("assets")
          var apk: JSONObject? = null
          for (j in 0 until assets.length()) {
            val a = assets.getJSONObject(j)
            if (a.getString("name").endsWith(".apk", true)) { apk = a; break }
          }
          if (apk == null) continue

          val release = Release(
            version = r.getString("tag_name").removePrefix("v"),
            notes = r.optString("body", ""),
            apkUrl = apk.getString("browser_download_url"),
            size = apk.optLong("size"),
          )
          if (best == null) best = release
        }

        best?.takeIf { isNewer(it.version, currentVersion) }
      }
    }

  /** ۱.۳.۰ تازه‌تر از ۱.۲.۹ است — مقایسهٔ عددی، نه الفبایی */
  fun isNewer(remote: String, local: String): Boolean {
    val a = remote.split(".", "-").mapNotNull { it.toIntOrNull() }
    val b = local.split(".", "-").mapNotNull { it.toIntOrNull() }
    for (i in 0 until maxOf(a.size, b.size)) {
      val x = a.getOrElse(i) { 0 }
      val y = b.getOrElse(i) { 0 }
      if (x != y) return x > y
    }
    // شماره یکی است ولی برچسب فرق دارد (مثلاً پیش‌نمایش) — تازه حساب نمی‌شود
    return false
  }

  /**
   * دانلود با گزارشِ پیشرفت. فایل در پوشهٔ خودِ برنامه می‌نشیند تا اجازهٔ
   * حافظهٔ گوشی لازم نشود.
   */
  suspend fun download(
    context: Context,
    release: Release,
    onProgress: (Int) -> Unit,
  ): Result<File> = withContext(Dispatchers.IO) {
    runCatching {
      val dir = File(context.cacheDir, "updates").apply { mkdirs() }
      dir.listFiles()?.forEach { it.delete() }          // نسخه‌های قبلی جا نگیرند
      val out = File(dir, "tohid-${release.version}.apk")

      val conn = (URL(release.apkUrl).openConnection() as HttpURLConnection).apply {
        instanceFollowRedirects = true
        connectTimeout = 20000
        readTimeout = 60000
      }
      conn.inputStream.use { input ->
        out.outputStream().use { output ->
          val total = if (release.size > 0) release.size else conn.contentLengthLong
          val buffer = ByteArray(64 * 1024)
          var done = 0L
          var last = -1
          while (true) {
            val n = input.read(buffer)
            if (n <= 0) break
            output.write(buffer, 0, n)
            done += n
            if (total > 0) {
              val pct = ((done * 100) / total).toInt()
              if (pct != last) { last = pct; onProgress(pct) }
            }
          }
        }
      }
      conn.disconnect()
      if (out.length() < 100_000) throw IllegalStateException("فایل ناقص دانلود شد")
      out
    }
  }

  /** فایل را به نصب‌کنندهٔ اندروید می‌دهد */
  fun install(context: Context, apk: File) {
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.files", apk)
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
  }

  private fun get(url: String): String {
    val conn = (URL(url).openConnection() as HttpURLConnection).apply {
      setRequestProperty("Accept", "application/vnd.github+json")
      setRequestProperty("User-Agent", "tohid-app")
      connectTimeout = 15000
      readTimeout = 20000
    }
    return try {
      if (conn.responseCode !in 200..299) throw IllegalStateException("GitHub جواب نداد (${conn.responseCode})")
      conn.inputStream.bufferedReader().readText()
    } finally {
      conn.disconnect()
    }
  }
}
