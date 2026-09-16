package ir.vil3ntec.admin.data

import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL

/**
 *  رسیدن به سرور از بیرونِ خانه — از راهِ همان دامنه‌ای که خودتان ساخته‌اید.
 *
 *  ⚠️ چرا مستقیم نمی‌شود: تونل عمداً فقط پورتِ عمومی را بیرون می‌دهد و پنل،
 *  فایل‌منیجر و ترمینال هرگز به اینترنت درز نمی‌کنند. آن تصمیم درست است.
 *
 *  پس سرور یک درِ جداگانه دارد (`/api/admin-gate`) که فقط با کلیدِ مخصوصِ
 *  همین گوشی باز می‌شود. بدونِ کلید، آن آدرس از بیرون دقیقاً مثلِ یک مسیرِ
 *  نبوده جواب می‌دهد — «not found» — پس کسی نمی‌فهمد اصلاً دری هست.
 *
 *  کلید یک بار، با همان نام و رمزِ مدیر گرفته می‌شود — در خانه یا بیرونش،
 *  فرقی ندارد — و رمزنگاری‌شده روی گوشی می‌ماند.
 */
data class RemoteAccess(
  val url: String,
  val gatePath: String,
  val gateHeader: String,
  val key: String,
  val deviceId: String,
) {
  val usable: Boolean get() = url.isNotBlank() && key.isNotBlank()

  /** آدرسِ کاملِ یک مسیرِ داخلی از راهِ در */
  fun wrap(path: String): String = url.trimEnd('/') + gatePath + path

  /** آیا آدرسِ سرور همان درِ دامنه است؟ (آن‌وقت راهِ دوم معنی ندارد) */
  fun sameAs(serverUrl: String): Boolean =
    url.trimEnd('/').equals(serverUrl.trim().trimEnd('/'), ignoreCase = true)
}

object Remote {

  /**
   * از سرور می‌پرسد آدرسِ بیرونی‌اش چیست و یک کلیدِ تازه برای این گوشی
   * می‌گیرد.
   *
   * ⚠️ فقط وقتی معنی دارد که همین حالا از داخلِ خانه وصل باشیم — درِ مدیر
   * عمداً اجازهٔ صدورِ کلید از بیرون را نمی‌دهد، وگرنه خودش را باز می‌کرد.
   */
  fun provision(session: Session, deviceId: String, deviceName: String): RemoteAccess? {
    val body = JSONObject().put("deviceId", deviceId).put("name", deviceName)
    val reply = Api.call(session, "/api/settings/remote/device", "POST", body).o()

    val url = reply.optString("url")
    val key = reply.optString("key")
    if (url.isBlank() || key.isBlank()) return null

    return RemoteAccess(
      url = url,
      gatePath = reply.optString("gatePath").ifBlank { "/api/admin-gate" },
      gateHeader = reply.optString("gateHeader").ifBlank { "x-admin-gate" },
      key = key,
      deviceId = reply.optString("deviceId").ifBlank { deviceId },
    )
  }

  /** فقط خبر گرفتن: آدرسِ بیرونی هست یا نه (بدونِ صدورِ کلیدِ تازه) */
  fun status(session: Session): JSONObject =
    Api.call(session, "/api/settings/remote").o()

  /* ------------------------------ بارِ اول ------------------------------ */

  /**
   *  گرفتنِ کلید با همان نام و رمز — از هر جای دنیا، بی نیاز به وای‌فایِ خانه.
   *
   *  ⚠️ چرا لازم شد: تا دیروز کلید فقط از داخلِ خانه صادر می‌شد. یعنی
   *  برنامه‌ای که بارِ اول بیرونِ خانه باز می‌شد هیچ راهی نداشت — درِ دامنه
   *  بی کلید بسته بود و کلید هم بی بودنِ داخلِ خانه صادر نمی‌شد. حالا همان
   *  نام و رمزِ مدیر، در را باز می‌کند.
   *
   *  ⚠️ این تابع خودش درخواست می‌زند و از `Api.call` رد نمی‌شود: هنوز نه
   *  نشستی هست، نه کلیدی — و راهِ دوگانهٔ آن‌جا این‌جا فقط دردسر است.
   *
   *  @return کلید، یا null اگر نشد (نامِ غلط، رمزِ غلط، یا اصلاً دری نبود).
   *    عمداً دلیلش را نمی‌گوید، چون خودِ سرور هم نمی‌گوید.
   */
  fun enroll(
    serverUrl: String,
    username: String,
    password: String,
    deviceId: String,
    deviceName: String,
  ): RemoteAccess? {
    val base = serverUrl.trim().trimEnd('/')
    if (base.isBlank()) return null

    val body = JSONObject()
      .put("username", username)
      .put("password", password)
      .put("deviceId", deviceId)
      .put("name", deviceName)

    val conn = URL("$base/api/admin-gate/enroll").openConnection() as HttpURLConnection
    val text = try {
      conn.requestMethod = "POST"
      conn.connectTimeout = 15_000
      conn.readTimeout = 15_000
      conn.doOutput = true
      conn.setRequestProperty("Accept", "application/json")
      conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
      conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      if (conn.responseCode !in 200..299) return null
      conn.inputStream.bufferedReader(Charsets.UTF_8).use(BufferedReader::readText)
    } catch (_: Exception) {
      return null
    } finally {
      conn.disconnect()
    }

    val reply = runCatching { JSONObject(text) }.getOrNull() ?: return null
    val key = reply.optString("key")
    if (key.isBlank()) return null

    return RemoteAccess(
      url = base,
      // روی زیردامنهٔ admin پیشوند لازم نیست؛ سرور خودش می‌گوید کدام
      gatePath = reply.optString("gatePath"),
      gateHeader = reply.optString("gateHeader").ifBlank { "x-admin-gate" },
      key = key,
      deviceId = reply.optString("deviceId").ifBlank { deviceId },
    )
  }
}
