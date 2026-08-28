package ir.vil3ntec.tohid.sync

import android.content.Context
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/**
 *  چیزهایی که برای همگام‌سازی باید بین اجراها بماند.
 *
 *  توکن، سایه، شمارهٔ آخرین تغییرِ گرفته‌شده و شناسهٔ همین دستگاه.
 *  شناسهٔ دستگاه یک بار ساخته می‌شود و دیگر عوض نمی‌شود: مجوزِ اشتراک به
 *  همان بسته است، و عوض شدنش یعنی مجوز دیگر مالِ این گوشی نیست.
 */
class SyncStore(context: Context) {

  private val prefs = context.getSharedPreferences("tohid-sync", Context.MODE_PRIVATE)
  private val json = Json { ignoreUnknownKeys = true; isLenient = true }

  val deviceUid: String
    get() = prefs.getString(DEVICE, null) ?: newDeviceUid().also {
      prefs.edit().putString(DEVICE, it).apply()
    }

  var serverUrl: String
    get() = prefs.getString(SERVER, "") ?: ""
    set(v) = prefs.edit().putString(SERVER, v.trim().trimEnd('/')).apply()

  var accessToken: String?
    get() = prefs.getString(ACCESS, null)
    set(v) = prefs.edit().putString(ACCESS, v).apply()

  var refreshToken: String?
    get() = prefs.getString(REFRESH, null)
    set(v) = prefs.edit().putString(REFRESH, v).apply()

  var accountName: String
    get() = prefs.getString(NAME, "") ?: ""
    set(v) = prefs.edit().putString(NAME, v).apply()

  var license: String?
    get() = prefs.getString(LICENSE, null)
    set(v) = prefs.edit().putString(LICENSE, v).apply()

  var publicKey: String?
    get() = prefs.getString(PUBLIC_KEY, null)
    set(v) = prefs.edit().putString(PUBLIC_KEY, v).apply()

  var revision: Long
    get() = prefs.getLong(REV, 0)
    set(v) = prefs.edit().putLong(REV, v).apply()

  var lastSyncAt: Long
    get() = prefs.getLong(LAST_SYNC, 0)
    set(v) = prefs.edit().putLong(LAST_SYNC, v).apply()

  /** آخرین وضعیتی که با سرور یکی بوده */
  var shadow: SyncEngine.Shadow
    get() {
      val raw = prefs.getString(SHADOW, null) ?: return SyncEngine.Shadow()
      return runCatching {
        val tree = json.parseToJsonElement(raw) as JsonObject
        SyncEngine.Shadow(
          tree.mapValues { (_, value) ->
            (value as JsonObject).mapValues { (_, fp) -> (fp as JsonPrimitive).content }
          }
        )
      }.getOrDefault(SyncEngine.Shadow())
    }
    set(value) {
      val tree = buildJsonObject {
        value.entries.forEach { (collection, rows) ->
          put(collection, buildJsonObject { rows.forEach { (id, fp) -> put(id, JsonPrimitive(fp)) } })
        }
      }
      prefs.edit().putString(SHADOW, tree.toString()).apply()
    }

  /** خروج از حساب — داده‌های دکان دست‌نخورده می‌مانند */
  fun signOut() {
    prefs.edit()
      .remove(ACCESS).remove(REFRESH).remove(NAME)
      .remove(LICENSE).remove(SHADOW).remove(REV).remove(LAST_SYNC)
      .apply()
  }

  private fun newDeviceUid(): String {
    val bytes = ByteArray(16)
    java.security.SecureRandom().nextBytes(bytes)
    return bytes.joinToString("") { "%02x".format(it) }
  }

  private companion object {
    const val DEVICE = "device_uid"
    const val SERVER = "server_url"
    const val ACCESS = "access_token"
    const val REFRESH = "refresh_token"
    const val NAME = "account_name"
    const val LICENSE = "license"
    const val PUBLIC_KEY = "public_key"
    const val SHADOW = "shadow"
    const val REV = "rev"
    const val LAST_SYNC = "last_sync"
  }
}
