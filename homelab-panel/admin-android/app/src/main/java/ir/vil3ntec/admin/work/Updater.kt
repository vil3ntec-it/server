package ir.vil3ntec.admin.work

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** نسخه‌ای که روی گیت‌هاب هست */
data class Release(
  val version: String,
  val notes: String,
  val downloadUrl: String,
  val sizeBytes: Long,
)

/** وضعیتِ دانلود، برای نوارِ پیشرفت */
data class Progress(val done: Long, val total: Long) {
  val percent: Int get() = if (total <= 0) 0 else ((done * 100) / total).toInt()
}

/**
 *  به‌روزرسانی از گیت‌هاب.
 *
 *  ⚠️ دانلود ازسرگرفتنی است و این خواستهٔ صریح بود: «موقع دانلود کنسل نشود
 *  و از سر نشود».
 *
 *  چطور: فایل در یک `.part` کنارِ خودش نوشته می‌شود و هر بار که دوباره
 *  شروع می‌کنیم، با هدرِ `Range: bytes=<آنچه داریم>-` از همان‌جا ادامه
 *  می‌گیرد. اینترنتِ خانگی که وسطِ یک فایلِ چند ده مگابایتی قطع شود — و
 *  می‌شود — دیگر یعنی چند ثانیه عقب‌گرد، نه شروع از صفر.
 *
 *  اگر سرور Range را نفهمد (۲۰۰ به‌جای ۲۰۶ برگرداند) از اول نوشته می‌شود،
 *  چون ادامه‌دادنِ کورکورانه فایلِ خراب می‌سازد.
 */
object Updater {

  private const val REPO = "vil3ntec-it/server"
  private const val TAG = "admin-android"

  /** آخرین نسخهٔ منتشرشده — یا null اگر چیزی نبود */
  fun latest(): Release? {
    val url = URL("https://api.github.com/repos/$REPO/releases/tags/$TAG")
    val conn = url.openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = 15_000
      conn.readTimeout = 15_000
      conn.setRequestProperty("Accept", "application/vnd.github+json")
      conn.setRequestProperty("User-Agent", "villain-admin")
      if (conn.responseCode !in 200..299) return null

      val body = conn.inputStream.bufferedReader().use { it.readText() }
      val release = JSONObject(body)
      val assets: JSONArray = release.optJSONArray("assets") ?: JSONArray()

      var apk: JSONObject? = null
      for (index in 0 until assets.length()) {
        val asset = assets.optJSONObject(index) ?: continue
        if (asset.optString("name").endsWith(".apk", ignoreCase = true)) {
          apk = asset
          break
        }
      }
      if (apk == null) return null

      // شمارهٔ نسخه از نامِ فایل: VillainAdmin-1.20.0.apk
      val version = Regex("(\\d+(?:\\.\\d+)+)").find(apk.optString("name"))?.value.orEmpty()

      return Release(
        version = version,
        notes = release.optString("body").take(4_000),
        downloadUrl = apk.optString("browser_download_url"),
        sizeBytes = apk.optLong("size"),
      )
    } finally {
      conn.disconnect()
    }
  }

  /** آیا `remote` از `local` جلوتر است؟ */
  fun isNewer(remote: String, local: String): Boolean {
    val a = remote.split(".", "-").mapNotNull { it.toIntOrNull() }
    val b = local.split(".", "-").mapNotNull { it.toIntOrNull() }
    for (index in 0 until maxOf(a.size, b.size)) {
      val left = a.getOrElse(index) { 0 }
      val right = b.getOrElse(index) { 0 }
      if (left != right) return left > right
    }
    return false
  }

  private fun partFile(context: Context, version: String): File {
    val dir = File(context.cacheDir, "updates").apply { mkdirs() }
    return File(dir, "VillainAdmin-$version.apk.part")
  }

  fun apkFile(context: Context, version: String): File {
    val dir = File(context.cacheDir, "updates").apply { mkdirs() }
    return File(dir, "VillainAdmin-$version.apk")
  }

  /**
   * دانلود — از همان‌جا که مانده بود.
   *
   * @param onProgress هر چند صد کیلوبایت یک بار صدا زده می‌شود
   * @return فایلِ آمادهٔ نصب
   */
  fun download(
    context: Context,
    release: Release,
    onProgress: (Progress) -> Unit,
  ): File {
    val target = apkFile(context, release.version)
    if (target.exists() && target.length() == release.sizeBytes && release.sizeBytes > 0) {
      onProgress(Progress(release.sizeBytes, release.sizeBytes))
      return target
    }

    val part = partFile(context, release.version)
    var already = if (part.exists()) part.length() else 0L
    if (release.sizeBytes in 1 until already) {
      // فایلِ نیمه‌کارهٔ بزرگ‌تر از خودِ فایل یعنی چیزی درست نیست
      part.delete()
      already = 0
    }

    val conn = URL(release.downloadUrl).openConnection() as HttpURLConnection
    try {
      conn.connectTimeout = 20_000
      conn.readTimeout = 60_000
      conn.setRequestProperty("User-Agent", "villain-admin")
      if (already > 0) conn.setRequestProperty("Range", "bytes=$already-")

      val status = conn.responseCode
      if (status !in 200..299) throw IOException("دانلود نشد ($status)")

      // ۲۰۶ یعنی سرور ادامه داد؛ ۲۰۰ یعنی از اول فرستاد
      val resumed = status == HttpURLConnection.HTTP_PARTIAL
      if (!resumed) already = 0

      val remaining = conn.contentLengthLong.coerceAtLeast(0)
      val total = if (release.sizeBytes > 0) release.sizeBytes else already + remaining

      FileOutputStream(part, resumed).use { out ->
        conn.inputStream.use { input ->
          val buffer = ByteArray(64 * 1024)
          var done = already
          var sinceReport = 0L
          while (true) {
            val read = input.read(buffer)
            if (read <= 0) break
            out.write(buffer, 0, read)
            done += read
            sinceReport += read
            if (sinceReport >= 256 * 1024) {
              sinceReport = 0
              onProgress(Progress(done, total))
            }
          }
          out.flush()
          onProgress(Progress(done, total))
        }
      }
    } finally {
      conn.disconnect()
    }

    if (release.sizeBytes > 0 && part.length() != release.sizeBytes) {
      throw IOException("فایل ناقص ماند — دوباره بزنید، از همین‌جا ادامه می‌دهد")
    }

    if (target.exists()) target.delete()
    if (!part.renameTo(target)) throw IOException("فایل جابه‌جا نشد")
    return target
  }

  /** فایل را به نصب‌کنندهٔ اندروید می‌دهد */
  fun install(context: Context, apk: File) {
    val uri: Uri = FileProvider.getUriForFile(context, "${context.packageName}.files", apk)
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
  }
}
