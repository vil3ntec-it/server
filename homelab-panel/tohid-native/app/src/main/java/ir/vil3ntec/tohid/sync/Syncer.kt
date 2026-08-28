package ir.vil3ntec.tohid.sync

import ir.vil3ntec.tohid.data.ShopStore
import kotlinx.serialization.json.JsonArray

/**
 *  یک دورِ کاملِ همگام‌سازی.
 *
 *  ترتیبش مهم است و عمداً همان ترتیبِ نسخهٔ وب است:
 *    ۱) تغییراتِ خودم را می‌فرستم و همان‌جا سایه را تازه می‌کنم
 *    ۲) تغییراتِ دیگران را صفحه‌به‌صفحه می‌گیرم و ادغام می‌کنم
 *    ۳) سایه را دوباره ثبت می‌کنم
 *
 *  گامِ سه بی‌اهمیت به نظر می‌رسد ولی نیست: بدونِ آن، داده‌ای که تازه از
 *  سرور گرفته‌ام دفعهٔ بعد به‌عنوانِ «تغییرِ محلی» دوباره فرستاده می‌شود و
 *  همگام‌سازی هیچ‌وقت آرام نمی‌گیرد.
 */
class Syncer(private val store: ShopStore, private val state: SyncStore) {

  data class Outcome(val pushed: Int, val pulled: Int, val revision: Long)

  suspend fun run(): Outcome {
    val token = state.accessToken ?: throw ServerClient.ServerError("ابتدا وارد حساب شوید", "no_account")
    val client = ServerClient(state.serverUrl)
    val device = state.deviceUid

    // ۱) فرستادن
    val outgoing = SyncEngine.collect(store.data.value, state.shadow, System.currentTimeMillis())
    if (outgoing.changes.isNotEmpty()) {
      client.push(token, device, outgoing.changes, outgoing.settings)
      state.shadow = SyncEngine.snapshot(store.data.value)
    }

    // ۲) گرفتن — صفحه‌به‌صفحه، با سقفی که حلقهٔ بی‌پایان نسازد
    var since = state.revision
    var pulled = 0
    var guard = 0
    while (guard++ < 50) {
      val page = client.pull(token, since, device)
      if (page.changes.isNotEmpty() || page.settings != null) {
        val merged = SyncEngine.merge(store.data.value, page.changes, page.settings)
        if (merged.touched > 0) store.save(merged.data)
        pulled += merged.touched
      }
      since = page.rev
      if (!page.hasMore) break
    }

    // ۳) آنچه تازه رسید نباید دفعهٔ بعد به‌عنوان تغییرِ محلی برگردد
    state.shadow = SyncEngine.snapshot(store.data.value)
    state.revision = since
    state.lastSyncAt = System.currentTimeMillis()

    return Outcome(pushed = outgoing.changes.size, pulled = pulled, revision = since)
  }

  /** گرفتن یا تازه‌کردنِ مجوزِ اشتراک */
  suspend fun refreshLicense(deviceName: String): License.Status {
    val token = state.accessToken ?: return License.Status(License.State.NONE, reason = "no_account")
    val client = ServerClient(state.serverUrl)

    if (state.publicKey.isNullOrBlank()) {
      state.publicKey = runCatching { client.publicKey() }.getOrNull()
    }

    val body = client.license(token, state.deviceUid, deviceName)
    val license = body["license"]?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
    // مجوز پیش از ذخیره بررسی می‌شود تا مجوزِ خراب ذخیره نشود
    if (!license.isNullOrBlank()) {
      val key = state.publicKey
      if (key != null && License.verify(license, key, state.deviceUid) is License.Verdict.Valid) {
        state.license = license
      }
    }
    return status()
  }

  fun status(): License.Status =
    License.status(state.license, state.publicKey, state.deviceUid, System.currentTimeMillis())

  private fun JsonArray.isNotEmpty(): Boolean = size > 0
}
