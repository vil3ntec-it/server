package ir.vil3ntec.tohid

import android.content.Context
import android.net.Uri
import android.webkit.WebResourceResponse
import java.io.ByteArrayInputStream

/**
 *  چیزهایی که برنامه از اینترنت می‌گیرد — از داخلِ خودِ برنامه داده می‌شود.
 *
 *  برنامه دو چیز را از بیرون می‌خواهد:
 *      • فونت فارسی از Google Fonts
 *      • موتور اسکنِ ZXing از unpkg (وقتی گوشی BarcodeDetector ندارد)
 *
 *  در دکانی که اینترنت ندارد، اولی یعنی متن با فونتِ غلط دیده می‌شود و دومی
 *  یعنی اسکنر روی بعضی گوشی‌ها اصلاً بالا نمی‌آید. هر دو داخلِ فایل نصبی
 *  گذاشته شده‌اند و درخواستشان همین‌جا جواب می‌گیرد — بدونِ دست زدن به
 *  خودِ برنامه.
 */
object Offline {

  private const val ASSETS = "https://appassets.androidplatform.net/assets/"

  /** اگر این درخواست را خودمان جواب می‌دهیم، پاسخ برمی‌گردد؛ وگرنه null */
  fun handle(context: Context, url: Uri): WebResourceResponse? {
    val host = url.host ?: return null
    val path = url.path ?: ""

    return when {
      // برگهٔ سبکِ فونت — همان چیزی که Google Fonts می‌داد
      host == "fonts.googleapis.com" ->
        asset(context, "vendor/fonts.css", "text/css")

      // فایل‌های فونت، اگر برنامه مستقیم سراغشان برود
      host == "fonts.gstatic.com" -> {
        val name = path.substringAfterLast('/')
        asset(context, "vendor/fonts/$name", "font/woff2")
      }

      // موتور اسکن
      host == "unpkg.com" && path.contains("zxing", ignoreCase = true) ->
        asset(context, "vendor/zxing.js", "application/javascript")

      else -> null
    }
  }

  /** آدرسِ داخلیِ برنامه، برای ساختنِ پیوند در فایل‌های تولیدی */
  fun assetUrl(name: String) = "$ASSETS$name"

  private fun asset(context: Context, name: String, mime: String): WebResourceResponse? = try {
    val bytes = context.assets.open(name).use { it.readBytes() }
    WebResourceResponse(
      mime,
      if (mime.startsWith("text/") || mime.endsWith("javascript")) "utf-8" else null,
      200,
      "OK",
      // بدونِ این، مرورگر برگهٔ سبکِ «بین‌مبدأیی» را کنار می‌گذارد
      mapOf("Access-Control-Allow-Origin" to "*", "Cache-Control" to "max-age=31536000"),
      ByteArrayInputStream(bytes),
    )
  } catch (e: Exception) {
    null
  }
}
