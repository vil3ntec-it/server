package ir.vil3ntec.tohid.sync

import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.security.KeyPair
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 *  بررسیِ مجوزِ اشتراک.
 *
 *  توکن‌ها با kotlinx ساخته می‌شوند نه org.json — آن یکی روی رایانه فقط
 *  یک پوستهٔ خالی است و هر متدش خطا می‌دهد، پس بررسیِ مجوز اصلاً قابلِ
 *  آزمودن نمی‌شد.
 *
 *  اینجا مجوزِ ساختگی نمی‌سازیم که بعد خودمان قبولش کنیم: یک کلیدِ واقعیِ
 *  P-256 ساخته می‌شود، توکن با همان امضا می‌شود، و بعد از همان راهی که
 *  برنامه می‌رود بررسی می‌شود. بعد همان توکن دست‌کاری می‌شود تا مطمئن
 *  شویم رد می‌شود — چون بررسی‌ای که چیزی را رد نکند، بررسی نیست.
 */
class LicenseTest {

  private val keys: KeyPair = KeyPairGenerator.getInstance("EC").apply {
    initialize(ECGenParameterSpec("secp256r1"))
  }.generateKeyPair()

  private val publicKeySpki: String = java.util.Base64.getEncoder().encodeToString(keys.public.encoded)
  private val device = "device-1234"
  private val now = 1_700_000_000_000L

  /* ------------------------- ساختنِ توکنِ واقعی ------------------------- */

  private fun encodeUrl(bytes: ByteArray): String =
    java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

  /** امضای جاوا DER است؛ سرور خام می‌فرستد، پس همان تبدیل اینجا هم لازم است */
  private fun derToRaw(der: ByteArray): ByteArray {
    var i = 2
    if (der[1].toInt() and 0xFF > 0x80) i = 3
    require(der[i] == 0x02.toByte())
    val rLen = der[i + 1].toInt()
    val r = der.copyOfRange(i + 2, i + 2 + rLen)
    var j = i + 2 + rLen
    require(der[j] == 0x02.toByte())
    val sLen = der[j + 1].toInt()
    val s = der.copyOfRange(j + 2, j + 2 + sLen)

    fun pad(v: ByteArray): ByteArray {
      val trimmed = v.dropWhile { it == 0.toByte() }.toByteArray()
      return ByteArray(32 - trimmed.size) + trimmed
    }
    return pad(r) + pad(s)
  }

  private fun token(
    payload: JsonObject,
    header: JsonObject = buildJsonObject {
      put("alg", JsonPrimitive("ES256")); put("typ", JsonPrimitive("TLIC"))
    },
    signWith: KeyPair = keys,
  ): String {
    val h = encodeUrl(header.toString().toByteArray())
    val b = encodeUrl(payload.toString().toByteArray())
    val der = Signature.getInstance("SHA256withECDSA").run {
      initSign(signWith.private)
      update("$h.$b".toByteArray())
      sign()
    }
    return "$h.$b.${encodeUrl(derToRaw(der))}"
  }

  private fun payload(
    issuer: String = "tohid-license-server",
    audience: String = "tohid-shop-app",
    duid: String = device,
    exp: Long = now + 30L * 24 * 3600 * 1000,
    subEnds: Long = now + 30L * 24 * 3600 * 1000,
    nbf: Long = now - 60_000,
  ) = buildJsonObject {
    put("iss", JsonPrimitive(issuer))
    put("aud", JsonPrimitive(audience))
    put("duid", JsonPrimitive(duid))
    put("sub", JsonPrimitive("acc-1"))
    put("iat", JsonPrimitive(now))
    put("nbf", JsonPrimitive(nbf))
    put("exp", JsonPrimitive(exp))
    put("sub_ends", JsonPrimitive(subEnds))
    put("feat", buildJsonArray { add(JsonPrimitive("sync")); add(JsonPrimitive("multi_device")) })
    put("core", buildJsonArray {
      add(JsonPrimitive("dashboard")); add(JsonPrimitive("products")); add(JsonPrimitive("settings"))
    })
    put("plan", JsonPrimitive("pro"))
    put("plan_title", JsonPrimitive("حرفه‌ای"))
  }

  /* ------------------------------ پذیرش ------------------------------ */

  @Test
  fun `مجوز درست پذیرفته می شود`() {
    val v = License.verify(token(payload()), publicKeySpki, device)
    assertTrue("رد شد: $v", v is License.Verdict.Valid)
    val p = (v as License.Verdict.Valid).payload
    assertEquals(device, p.deviceUid)
    assertEquals("acc-1", p.accountId)
    assertEquals(listOf("sync", "multi_device"), p.features)
    assertEquals("حرفه‌ای", p.planTitle)
  }

  /* ------------------------------ ردها ------------------------------ */

  private fun reasonOf(t: String, key: String = publicKeySpki, uid: String = device): String {
    val v = License.verify(t, key, uid)
    assertTrue("انتظار می‌رفت رد شود", v is License.Verdict.Invalid)
    return (v as License.Verdict.Invalid).reason
  }

  @Test
  fun `دست کاری در محتوا امضا را خراب می کند`() {
    val good = token(payload())
    val parts = good.split(".")
    // یک اشتراکِ همیشگی برای خودمان می‌سازیم — باید رد شود
    val original = kotlinx.serialization.json.Json
      .parseToJsonElement(String(License.decodeUrl(parts[1])))
      .let { it as JsonObject }
    val tampered = JsonObject(
      original + ("exp" to JsonPrimitive(now + 100L * 365 * 24 * 3600 * 1000))
    )
    val forged = parts[0] + "." + encodeUrl(tampered.toString().toByteArray()) + "." + parts[2]
    assertEquals("signature", reasonOf(forged))
  }

  @Test
  fun `امضای کلید دیگری پذیرفته نمی شود`() {
    val other = KeyPairGenerator.getInstance("EC").apply {
      initialize(ECGenParameterSpec("secp256r1"))
    }.generateKeyPair()
    assertEquals("signature", reasonOf(token(payload(), signWith = other)))
  }

  @Test
  fun `مجوز دستگاه دیگری پذیرفته نمی شود`() {
    assertEquals("device_mismatch", reasonOf(token(payload(duid = "گوشیِ-دیگر"))))
  }

  @Test
  fun `صادرکننده و مخاطب باید همان باشند`() {
    assertEquals("issuer", reasonOf(token(payload(issuer = "کسِ-دیگر"))))
    assertEquals("audience", reasonOf(token(payload(audience = "برنامهٔ-دیگر"))))
  }

  @Test
  fun `الگوریتم دیگری قبول نمی شود`() {
    // «none» همان حمله‌ی کلاسیک روی توکن‌های امضاشده است
    val none = buildJsonObject { put("alg", JsonPrimitive("none")); put("typ", JsonPrimitive("TLIC")) }
    assertEquals("header", reasonOf(token(payload(), header = none)))
    val wrongType = buildJsonObject { put("alg", JsonPrimitive("ES256")); put("typ", JsonPrimitive("JWT")) }
    assertEquals("header", reasonOf(token(payload(), header = wrongType)))
  }

  @Test
  fun `توکن بدشکل رد می شود`() {
    assertEquals("format", reasonOf("چیزی-نیست"))
    assertEquals("format", reasonOf("a.b"))
    assertEquals("format", reasonOf("###.###.###"))
  }

  /* ------------------------------ وضعیت ------------------------------ */

  @Test
  fun `اشتراک فعال، مهلت و تمام شده از هم جدا می شوند`() {
    val day = 24L * 3600 * 1000

    val active = License.status(token(payload()), publicKeySpki, device, now)
    assertEquals(License.State.ACTIVE, active.state)
    assertEquals(listOf("sync", "multi_device"), active.features)

    // اشتراک تمام شده ولی هنوز در مهلت — کار می‌کند
    val grace = License.status(
      token(payload(subEnds = now - day, exp = now + 3 * day)), publicKeySpki, device, now,
    )
    assertEquals(License.State.GRACE, grace.state)
    assertEquals(listOf("sync", "multi_device"), grace.features)

    // مهلت هم تمام شده — قابلیت‌ها بسته می‌شوند
    val expired = License.status(
      token(payload(subEnds = now - 5 * day, exp = now - day)), publicKeySpki, device, now,
    )
    assertEquals(License.State.EXPIRED, expired.state)
    assertTrue(expired.features.isEmpty())

    // مجوزی که هنوز شروع نشده
    val pending = License.status(
      token(payload(nbf = now + day)), publicKeySpki, device, now,
    )
    assertEquals(License.State.PENDING, pending.state)
  }

  @Test
  fun `نبودن مجوز با نامعتبر بودنش یکی نیست`() {
    assertEquals(License.State.NONE, License.status(null, publicKeySpki, device, now).state)
    assertEquals(License.State.NONE, License.status(token(payload()), null, device, now).state)
    assertEquals(License.State.INVALID, License.status("خراب", publicKeySpki, device, now).state)
  }

  /* --------------------------- تبدیل امضا --------------------------- */

  @Test
  fun `تبدیل امضای خام به DER با خود جاوا سازگار است`() {
    // امضای واقعی، صد بار — تا حالتی که r یا s با بیتِ روشن شروع می‌شود
    // یا صفرِ ابتدایی دارد هم بیفتد
    repeat(100) { i ->
      val message = "پیام شمارهٔ $i".toByteArray()
      val der = Signature.getInstance("SHA256withECDSA").run {
        initSign(keys.private); update(message); sign()
      }
      val roundTripped = License.rawToDer(derToRaw(der))
      val verified = Signature.getInstance("SHA256withECDSA").run {
        initVerify(keys.public); update(message); verify(roundTripped)
      }
      assertTrue("امضای شمارهٔ $i بعد از تبدیل درست نماند", verified)
    }
  }

  @Test
  fun `base64 دستی همان جواب جاوا را می دهد`() {
    val random = java.util.Random(7)
    repeat(200) {
      val bytes = ByteArray(random.nextInt(80)).also { random.nextBytes(it) }
      val standard = java.util.Base64.getEncoder().encodeToString(bytes)
      assertTrue(bytes.contentEquals(License.decodeBase64(standard)))
      val url = java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
      assertTrue(bytes.contentEquals(License.decodeUrl(url)))
    }
  }
}
