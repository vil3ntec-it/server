package ir.vil3ntec.tohid.sync

import org.json.JSONObject
import java.security.KeyFactory
import java.security.Signature
import java.security.spec.X509EncodedKeySpec

/**
 *  بررسیِ مجوزِ اشتراک.
 *
 *  مجوز یک توکنِ امضاشده است: `header.payload.signature` با ES256 روی
 *  منحنیِ P-256. بدونِ امضای معتبر هیچ چیزی پذیرفته نمی‌شود — نه تاریخ،
 *  نه قابلیت، نه نامِ پلن. وگرنه هرکسی می‌توانست با دست‌کاریِ یک فایلِ
 *  متنی، اشتراکِ همیشگی برای خودش بسازد.
 *
 *  دو نکتهٔ فنی که اشتباه‌شان کلِ بررسی را بی‌اثر می‌کند:
 *    • امضا خام است (r و s پشتِ سرِ هم، ۶۴ بایت) ولی جاوا فقط DER
 *      می‌فهمد، پس باید تبدیل شود. اگر تبدیل نشود، جاوا امضا را خراب
 *      می‌داند و هیچ مجوزی هرگز قبول نمی‌شود.
 *    • کدگذاری base64url است، نه base64 معمولی.
 */
object License {

  private const val ISSUER = "tohid-license-server"
  private const val AUDIENCE = "tohid-shop-app"

  data class Payload(
    val deviceUid: String,
    val accountId: String,
    val issuedAt: Long,
    val notBefore: Long,
    val expiresAt: Long,
    val subscriptionEndsAt: Long,
    val features: List<String>,
    val core: List<String>,
    val plan: String?,
    val planTitle: String?,
  )

  sealed interface Verdict {
    data class Valid(val payload: Payload) : Verdict
    /** دلیل به همان کدهای نسخهٔ وب: format | header | signature | issuer | audience | device_mismatch */
    data class Invalid(val reason: String) : Verdict
  }

  /** وضعیتِ اشتراک در همین لحظه */
  enum class State { NONE, INVALID, PENDING, ACTIVE, GRACE, EXPIRED }

  data class Status(
    val state: State,
    val payload: Payload? = null,
    val reason: String? = null,
  ) {
    val features: List<String> get() = if (state == State.ACTIVE || state == State.GRACE) payload?.features.orEmpty() else emptyList()
  }

  /**
   * امضا و ساختارِ مجوز.
   *
   * @param publicKeySpki کلیدِ عمومیِ سرور، base64 از SPKI DER
   * @param deviceUid شناسهٔ همین دستگاه — مجوزِ دستگاهِ دیگری پذیرفته نمی‌شود
   */
  fun verify(token: String, publicKeySpki: String, deviceUid: String): Verdict {
    val parts = token.split('.')
    if (parts.size != 3) return Verdict.Invalid("format")

    val header: JSONObject
    val payload: JSONObject
    try {
      header = JSONObject(String(decodeUrl(parts[0]), Charsets.UTF_8))
      payload = JSONObject(String(decodeUrl(parts[1]), Charsets.UTF_8))
    } catch (e: Exception) {
      return Verdict.Invalid("format")
    }

    if (header.optString("alg") != "ES256" || header.optString("typ") != "TLIC") {
      return Verdict.Invalid("header")
    }

    val signed = "${parts[0]}.${parts[1]}".toByteArray(Charsets.UTF_8)
    val ok = try {
      val key = KeyFactory.getInstance("EC")
        .generatePublic(X509EncodedKeySpec(decodeBase64(publicKeySpki.trim())))
      Signature.getInstance("SHA256withECDSA").run {
        initVerify(key)
        update(signed)
        verify(rawToDer(decodeUrl(parts[2])))
      }
    } catch (e: Exception) {
      return Verdict.Invalid("crypto_error")
    }
    if (!ok) return Verdict.Invalid("signature")

    // امضا درست است؛ حالا ببینیم مالِ همین برنامه و همین دستگاه است
    if (payload.optString("iss") != ISSUER) return Verdict.Invalid("issuer")
    if (payload.optString("aud") != AUDIENCE) return Verdict.Invalid("audience")
    if (payload.optString("duid") != deviceUid) return Verdict.Invalid("device_mismatch")

    return Verdict.Valid(
      Payload(
        deviceUid = payload.optString("duid"),
        accountId = payload.optString("sub"),
        issuedAt = payload.optLong("iat"),
        notBefore = payload.optLong("nbf"),
        expiresAt = payload.optLong("exp"),
        subscriptionEndsAt = payload.optLong("sub_ends"),
        features = payload.optJSONArray("feat").toStringList(),
        core = payload.optJSONArray("core").toStringList(),
        plan = payload.optString("plan").ifBlank { null },
        planTitle = payload.optString("plan_title").ifBlank { null },
      )
    )
  }

  /**
   * وضعیت بر اساسِ مجوزِ ذخیره‌شده — همان حالت‌هایی که نسخهٔ وب داشت.
   * «مهلت» بازه‌ای است که اشتراک تمام شده ولی هنوز کار می‌کند.
   */
  fun status(token: String?, publicKeySpki: String?, deviceUid: String, now: Long): Status {
    if (token.isNullOrBlank() || publicKeySpki.isNullOrBlank()) return Status(State.NONE, reason = "no_license")

    return when (val v = verify(token, publicKeySpki, deviceUid)) {
      is Verdict.Invalid -> Status(State.INVALID, reason = v.reason)
      is Verdict.Valid -> {
        val p = v.payload
        when {
          now < p.notBefore -> Status(State.PENDING, p, "not_started")
          now > p.expiresAt -> Status(State.EXPIRED, p, "expired")
          now > p.subscriptionEndsAt -> Status(State.GRACE, p)
          else -> Status(State.ACTIVE, p)
        }
      }
    }
  }

  /* ------------------------------ ریزه‌کاری ------------------------------ */

  private fun org.json.JSONArray?.toStringList(): List<String> {
    if (this == null) return emptyList()
    return (0 until length()).mapNotNull { optString(it).takeIf { s -> s.isNotBlank() } }
  }

  /** base64url — بدونِ padding، با `-` و `_` به‌جای `+` و `/` */
  fun decodeUrl(text: String): ByteArray = decodeBase64(text.replace('-', '+').replace('_', '/'))

  /**
   * base64، دستی.
   *
   * `java.util.Base64` از اندروید ۸ به بعد هست و این برنامه از اندروید ۷
   * کار می‌کند؛ `android.util.Base64` هم روی رایانه (هنگام آزمون) وجود
   * ندارد. بیست خط کد، هر دو مشکل را حل می‌کند.
   */
  fun decodeBase64(text: String): ByteArray {
    val clean = text.filter { it != '\n' && it != '\r' && it != ' ' && it != '=' }
    val out = java.io.ByteArrayOutputStream(clean.length * 3 / 4 + 3)
    var buffer = 0
    var bits = 0
    for (c in clean) {
      val v = ALPHABET.indexOf(c)
      require(v >= 0) { "نویسهٔ نامعتبر در base64" }
      buffer = (buffer shl 6) or v
      bits += 6
      if (bits >= 8) {
        bits -= 8
        out.write((buffer shr bits) and 0xFF)
      }
    }
    return out.toByteArray()
  }

  private const val ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


  /**
   * امضای خام (r||s) به DER.
   *
   * هر عدد باید به‌صورت INTEGER با کمترین طول نوشته شود، و اگر بیتِ اولش
   * ۱ باشد یک بایتِ صفر جلویش می‌آید — وگرنه DER آن را عددِ منفی می‌خواند.
   */
  fun rawToDer(raw: ByteArray): ByteArray {
    require(raw.size % 2 == 0 && raw.isNotEmpty()) { "طولِ امضا درست نیست" }
    val half = raw.size / 2
    val r = asInteger(raw.copyOfRange(0, half))
    val s = asInteger(raw.copyOfRange(half, raw.size))

    val body = r + s
    val out = ArrayList<Byte>(body.size + 4)
    out.add(0x30)
    if (body.size >= 0x80) {
      out.add(0x81.toByte())
      out.add(body.size.toByte())
    } else {
      out.add(body.size.toByte())
    }
    out.addAll(body.toList())
    return out.toByteArray()
  }

  private fun asInteger(value: ByteArray): ByteArray {
    var start = 0
    while (start < value.size - 1 && value[start] == 0.toByte()) start++
    var trimmed = value.copyOfRange(start, value.size)
    // بیتِ اولِ روشن یعنی «منفی» در DER، پس یک صفر جلویش می‌آید
    if (trimmed.isNotEmpty() && (trimmed[0].toInt() and 0x80) != 0) {
      trimmed = byteArrayOf(0) + trimmed
    }
    return byteArrayOf(0x02, trimmed.size.toByte()) + trimmed
  }
}
