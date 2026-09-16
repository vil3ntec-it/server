package ir.vil3ntec.admin.data

import org.json.JSONObject

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
 *  کلید فقط یک بار، از داخلِ خانه و با ورودِ مدیر گرفته می‌شود و رمزنگاری‌شده
 *  روی گوشی می‌ماند.
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
}
