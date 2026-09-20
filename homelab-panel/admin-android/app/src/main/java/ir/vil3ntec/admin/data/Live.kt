package ir.vil3ntec.admin.data

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.shareIn
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.coroutines.coroutineContext

/**
 *  جریانِ زنده — «چه چیزی عوض شد»، نه نبضِ کور.
 *
 *  ── چه اشکالی را می‌بندد ────────────────────────────────────────────
 *  گزارشِ صاحب سامانه: «توی همون بخش مد نظر استم و هیچی نمیاد؛ باید از
 *  اون بخش بیرون بشم یا از برنامه تا دوباره بیام و ببینم.»
 *
 *  هر صفحهٔ این اپ نبضِ خودش را داشت — پشتیبانی هر پنج ثانیه، گفت‌وگو هر
 *  سه ثانیه — و بقیه هیچ. یعنی هم دیر می‌آمد، هم باتری و دادهٔ گوشی را
 *  می‌خورد حتی وقتی هیچ اتفاقی نیفتاده بود.
 *  ──────────────────────────────────────────────────────────────────
 *
 *  ⚠️ **SSE، نه وب‌سوکت و نه Socket.IO.** این اپ عمداً هیچ کتابخانهٔ
 *  شبکه‌ای ندارد و `HttpURLConnection`ِ خودِ اندروید خواندنِ خطبه‌خطِ SSE
 *  را رایگان انجام می‌دهد. Socket.IO این‌جا یعنی یک وابستگیِ تازه که
 *  باید به‌روز بماند و می‌تواند ساخت را بخواباند.
 *
 *  ⛔ **و بی تلاشِ بی‌پایان**: قطع که شد، با فاصلهٔ فزاینده دوباره وصل
 *  می‌شود. حلقهٔ تنگ روی گوشی یعنی باتریِ تمام‌شده تا ظهر.
 */
object Live {

  /** موضوع‌هایی که این اپ به آن‌ها بند است */
  const val SUPPORT = "support"
  const val CODES = "codes"
  const val LOGINS = "logins"
  const val CUSTOMERS = "customers"

  private const val CONNECT_MS = 15_000
  //  ⚠️ مهلتِ خواندن باید از ضربانِ سرور (۲۵ث) بلندتر باشد، وگرنه هر
  //  جریانِ سالمی بینِ دو ضربان «تمام شد» خوانده می‌شود.
  private const val READ_MS = 90_000

  /**
   *  یک رویدادِ «عوض شد».
   *
   *  @param topic نامِ موضوع · @param at زمانِ سرور
   */
  data class Changed(val topic: String, val at: Long)

  /*
   *  ── یک اتصال برای همهٔ صفحه‌ها ──────────────────────────────────
   *
   *  ⛔ هر صفحه‌ای که خودش `stream` را جمع کند، یک اتصالِ **جدا** باز
   *  می‌کند. با باز بودنِ فهرستِ پشتیبانی و یک گفت‌وگو، یعنی دو جریانِ
   *  هم‌زمان برای یک کار — روی گوشی یعنی دو برابر باتری و دو برابر
   *  دادهٔ همراه، برای هیچ.
   *
   *  `shareIn` با `WhileSubscribed` دقیقاً همین را حل می‌کند: اولین
   *  صفحه اتصال را باز می‌کند، بقیه همان را می‌بینند، و با رفتنِ آخرین
   *  صفحه بسته می‌شود.
   *
   *  ⚠️ مهلتِ پنج‌ثانیه‌ایِ `WhileSubscribed` عمدی است: رفتن از یک صفحه
   *  به صفحهٔ بعد نباید اتصال را ببندد و همان لحظه دوباره باز کند.
   */
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private var shared: Flow<Changed>? = null
  private var sharedKey: String = ""

  @Synchronized
  fun shared(session: Session): Flow<Changed> {
    //  عوض شدنِ حساب یا سرور ⇒ جریانِ تازه، وگرنه همان
    val key = session.serverUrl.trimEnd('/') + "|" + (session.token ?: "") + "|" + (session.remote?.key ?: "")
    val current = shared
    if (current != null && sharedKey == key) return current
    sharedKey = key
    val made = stream(session).shareIn(scope, SharingStarted.WhileSubscribed(5_000), 0)
    shared = made
    return made
  }

  /**
   * جریانِ رویدادها — تا وقتی جمع‌کننده زنده است، باز می‌ماند.
   *
   * ⚠️ خودش دوباره وصل می‌شود؛ صفحه فقط جمع می‌کند و کاری به قطع و وصل
   * ندارد. ⚠️ صفحه‌ها این را مستقیم صدا نمی‌زنند — `shared` را.
   */
  fun stream(session: Session): Flow<Changed> = flow {
    var attempt = 0
    while (true) {
      coroutineContext.ensureActive()
      val ok = readOnce(session) { emit(it) }
      //  وصل شد و کار کرد ⇒ شمارنده از نو؛ نشد ⇒ کمی بیشتر صبر کن
      attempt = if (ok) 0 else (attempt + 1).coerceAtMost(6)
      kotlinx.coroutines.delay(backoffMs(attempt))
    }
  }

  /** ۱ث · ۲ · ۴ · ۸ · ۱۶ · ۳۰ · ۳۰ — سقف دارد و بالا نمی‌رود */
  fun backoffMs(attempt: Int): Long =
    if (attempt <= 0) 1_000L else minOf(30_000L, 1_000L * (1L shl minOf(attempt, 5)))

  /**
   *  یک بار وصل شدن و خواندن تا قطع شدن.
   *
   *  @return آیا اصلاً وصل شد (برای تصمیمِ فاصلهٔ تلاشِ بعدی)
   */
  private suspend fun readOnce(session: Session, onEvent: suspend (Changed) -> Unit): Boolean =
    withContext(Dispatchers.IO) {
      val base = session.serverUrl.trimEnd('/')
      val gate = session.remote?.takeIf { it.usable }
      val path = "/api/live/stream?token=" + java.net.URLEncoder.encode(session.token ?: "", "UTF-8")
      /*
       *  ⚠️ از بیرونِ خانه همان مسیر از **درِ کلیددار** می‌رود — همان
       *  قاعدهٔ `Api.call`. بی این، جریانِ زنده فقط روی وای‌فایِ خانه کار
       *  می‌کرد و بیرون از خانه اپ دوباره مرده به نظر می‌رسید.
       */
      val url = if (gate != null) gate.wrap(path) else base + path

      var connected = false
      val conn = URL(url).openConnection() as HttpURLConnection
      try {
        conn.connectTimeout = CONNECT_MS
        conn.readTimeout = READ_MS
        conn.setRequestProperty("Accept", "text/event-stream")
        conn.setRequestProperty("Cache-Control", "no-cache")
        session.token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
        gate?.let { conn.setRequestProperty(it.gateHeader, it.key) }

        if (conn.responseCode !in 200..299) return@withContext false
        connected = true

        val reader = conn.inputStream.bufferedReader(Charsets.UTF_8)
        var event = ""
        var data = ""
        while (true) {
          coroutineContext.ensureActive()
          val line = reader.readLine() ?: break
          when {
            //  خطِ خالی = پایانِ یک پاکت
            line.isEmpty() -> {
              if (event == "changed" && data.isNotBlank()) {
                val o = runCatching { JSONObject(data) }.getOrNull()
                val topic = o?.optString("topic").orEmpty()
                if (topic.isNotBlank()) onEvent(Changed(topic, o?.optLong("at") ?: 0L))
              }
              event = ""; data = ""
            }
            //  ضربانِ نگه‌داشتنِ اتصال — عمداً نادیده
            line.startsWith(":") -> Unit
            line.startsWith("event: ") -> event = line.removePrefix("event: ").trim()
            line.startsWith("data: ") -> data = line.removePrefix("data: ")
          }
        }
        true
      } catch (_: Exception) {
        connected
      } finally {
        runCatching { conn.disconnect() }
      }
    }
}

/**
 *  پلِ جریانِ زنده به یک صفحهٔ Compose.
 *
 *  ⚠️ چرا یک جا: هر صفحه‌ای که خودش `collect` می‌نوشت، یک جریانِ جدا و
 *  یک اتصالِ جدا باز می‌کرد — روی گوشی یعنی چند اتصالِ هم‌زمان برای یک
 *  کار. این‌جا هر صفحه فقط می‌گوید به کدام موضوع بند است.
 *
 *  ⚠️ و سرِ باز شدنِ صفحه **یک بار** خوانده می‌شود: جریان فقط «از این به
 *  بعد» را می‌گوید، نه آن‌چه پیش از وصل شدن گذشته.
 */
@androidx.compose.runtime.Composable
fun LiveWatch(
  session: Session,
  vararg topics: String,
  /**
   *  هر چیزی که عوض شدنش یعنی «این بار چیزِ دیگری را بخوان» — فیلترِ
   *  برنامه، شناسهٔ گفت‌وگو، و مانندِ آن.
   *
   *  ⚠️ بی این، عوض کردنِ فیلتر یا باز کردنِ گفت‌وگوی دیگر صفحه را تازه
   *  نمی‌کرد: اثر یک بار بسته می‌شد و دیگر با ورودیِ تازه راه نمی‌افتاد.
   */
  key: Any? = null,
  onChange: suspend () -> Unit,
) {
  val topicKey = topics.joinToString(",")
  androidx.compose.runtime.LaunchedEffect(topicKey, key, session.token, session.serverUrl) {
    onChange()
    val want = topicKey.split(",").toSet()
    Live.shared(session).collect { if (it.topic in want) onChange() }
  }
}
