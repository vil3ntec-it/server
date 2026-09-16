package ir.vil3ntec.admin.data

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 *  تنها جایی که با سرور حرف می‌زند.
 *
 *  ⚠️ عمداً بدونِ کتابخانهٔ شبکه نوشته شده: HttpURLConnection خودِ اندروید
 *  همین کار را می‌کند و هر وابستگیِ تازه یعنی یک چیزِ دیگر که باید
 *  به‌روز بماند و می‌تواند ساختِ برنامه را بخواباند. همین‌جا هم کافی است.
 *
 *  ⚠️ هیچ تابعی این‌جا استثنا پنهان نمی‌کند: خطا بالا می‌رود تا صفحه بتواند
 *  به آدم بگوید چه شد. «لیستِ خالی» به‌جای «سرور جواب نداد» بدترین حالت است،
 *  چون آدم فکر می‌کند چیزی نیست در حالی که اتصال قطع بوده.
 */
class ApiError(val status: Int, val code: String, message: String) : IOException(message)

object Api {

  /** چیزی که سرور برگردانده — یا شیء، یا آرایه */
  class Reply(val obj: JSONObject?, val arr: JSONArray?) {
    fun o(): JSONObject = obj ?: JSONObject()
    fun items(key: String): JSONArray = obj?.optJSONArray(key) ?: arr ?: JSONArray()
  }

  private fun url(session: Session, path: String): URL {
    val base = session.serverUrl.trimEnd('/')
    return URL(if (path.startsWith("http")) path else base + path)
  }

  /**
   * یک درخواست.
   *
   * ⚠️ اول آدرسِ خانه، بعد دامنه.
   *
   * وقتی گوشی روی وای‌فایِ خانه است، آدرسِ محلی هم سریع‌تر است هم از
   * اینترنت رد نمی‌شود. وقتی بیرونید، آن آدرس اصلاً وجود ندارد — پس اگر
   * *وصل نشد*، همان درخواست از راهِ دامنه و درِ مدیر دوباره فرستاده می‌شود.
   *
   * ⚠️ فقط شکستِ اتصال باعثِ تلاشِ دوم می‌شود، نه خطای خودِ سرور: اگر سرور
   * «رمز غلط» گفته، تکرارش از راهِ دیگر همان جواب را می‌دهد و فقط وقت
   * می‌برد — و بدتر، یک تلاشِ ناموفقِ دیگر روی شمارنده می‌گذارد.
   */
  fun call(
    session: Session,
    path: String,
    method: String = "GET",
    body: JSONObject? = null,
    timeoutMs: Int = 20_000,
  ): Reply {
    return try {
      raw(session, url(session, path), method, body, timeoutMs, null)
    } catch (e: IOException) {
      if (e is ApiError) throw e
      val remote = session.remote
      if (remote == null || !remote.usable || path.startsWith("http")) throw e
      raw(session, URL(remote.wrap(path)), method, body, timeoutMs, remote)
    }
  }

  private fun raw(
    session: Session,
    target: URL,
    method: String,
    body: JSONObject?,
    timeoutMs: Int,
    gate: RemoteAccess?,
  ): Reply {
    val conn = target.openConnection() as HttpURLConnection
    try {
      conn.requestMethod = method
      conn.connectTimeout = timeoutMs
      conn.readTimeout = timeoutMs
      conn.setRequestProperty("Accept", "application/json")
      session.token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
      // کلیدِ در فقط روی همان درخواستی می‌نشیند که از راهِ دامنه می‌رود
      gate?.let { conn.setRequestProperty(it.gateHeader, it.key) }

      if (body != null) {
        conn.doOutput = true
        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
        conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
      }

      val status = conn.responseCode
      val stream = if (status in 200..299) conn.inputStream else conn.errorStream
      val text = stream?.bufferedReader(Charsets.UTF_8)?.use(BufferedReader::readText).orEmpty()

      if (status !in 200..299) {
        val parsed = runCatching { JSONObject(text) }.getOrNull()
        val code = parsed?.optString("error").orEmpty().ifEmpty { "http_$status" }
        val message = parsed?.optString("message").orEmpty().ifEmpty { messageFor(status) }
        throw ApiError(status, code, message)
      }

      val trimmed = text.trim()
      return when {
        trimmed.startsWith("[") -> Reply(null, JSONArray(trimmed))
        trimmed.startsWith("{") -> Reply(JSONObject(trimmed), null)
        else -> Reply(JSONObject(), null)
      }
    } finally {
      conn.disconnect()
    }
  }

  /** پیامی که آدم بفهمد، نه یک عددِ خشک */
  private fun messageFor(status: Int): String = when (status) {
    401 -> "ورود لازم است — دوباره وارد شوید"
    403 -> "این کار اجازه نمی‌خواهد"
    404 -> "این آدرس روی سرور نیست"
    429 -> "درخواست‌ها زیاد شد — کمی صبر کنید"
    in 500..599 -> "سرور خطا داد"
    else -> "ارتباط برقرار نشد ($status)"
  }

  /* ----------------------------- ورود ---------------------------------- */

  /** سرور زنده است؟ پیش از ورود، تا آدرسِ غلط را همان‌جا بفهمیم */
  fun health(serverUrl: String): JSONObject {
    val probe = Session(serverUrl = serverUrl, token = null, username = "")
    return call(probe, "/health", timeoutMs = 8_000).o()
  }

  fun login(serverUrl: String, username: String, password: String): JSONObject {
    val probe = Session(serverUrl = serverUrl, token = null, username = "")
    val body = JSONObject().put("username", username).put("password", password)
    return call(probe, "/api/auth/login", "POST", body).o()
  }

  /* --------------------------- کدهای شش‌رقمی ---------------------------- */

  fun liveCodes(session: Session, app: String? = null): Reply {
    val query = if (app.isNullOrBlank()) "" else "?app=" + app.trim()
    return call(session, "/api/codes-admin/live$query")
  }

  fun codeApps(session: Session): Reply = call(session, "/api/codes-admin/apps")

  /* ----------------------------- حساب‌ها -------------------------------- */

  /** حساب‌های فروشگاه (توحید) */
  fun shopAccounts(session: Session, q: String = ""): Reply =
    call(session, "/api/control/tohid/accounts" + if (q.isBlank()) "" else "?q=$q")

  fun shopAccount(session: Session, id: String): Reply =
    call(session, "/api/control/tohid/accounts/$id")

  /** پمپ‌بنزین‌ها */
  fun stations(session: Session): Reply = call(session, "/api/stations-admin/")

  /** سایت‌های روی سرور */
  fun sites(session: Session): Reply = call(session, "/api/sites")

  /** کاربرانِ خودِ پنل */
  fun panelUsers(session: Session): Reply = call(session, "/api/auth/users")

  /* ---------------------------- اشتراک‌ها ------------------------------- */

  fun plans(session: Session): Reply = call(session, "/api/control/tohid/plans")

  /**
   * دادنِ اشتراک به یک حساب.
   *
   * سرور با «مقدار + واحد» کار می‌کند نه با تعدادِ روز (یک ماه یعنی یک ماه،
   * نه سی روز)، پس همان را می‌فرستیم تا تاریخِ پایان دقیقاً همانی شود که
   * در پنل هم دیده می‌شود.
   */
  fun grantSubscription(
    session: Session,
    accountId: String,
    planCode: String,
    amount: Int,
    unit: String,
  ): Reply {
    val body = JSONObject()
      .put("planCode", planCode)
      .put("amount", amount)
      .put("unit", unit)
    return call(session, "/api/control/tohid/accounts/$accountId/vip", "POST", body)
  }

  fun extendSubscription(session: Session, subscriptionId: String, amount: Int, unit: String): Reply {
    val body = JSONObject().put("amount", amount).put("unit", unit)
    return call(session, "/api/control/tohid/subscriptions/$subscriptionId/extend", "POST", body)
  }

  fun setSubscriptionStatus(session: Session, subscriptionId: String, status: String): Reply {
    val body = JSONObject().put("status", status)
    return call(session, "/api/control/tohid/subscriptions/$subscriptionId/status", "POST", body)
  }

  /* ---------------------------- پشتیبانی -------------------------------- */

  /**
   * گفت‌وگوها. `app` بخش را جدا می‌کند: پمپ، فروشگاه، سایت‌ها.
   */
  fun supportThreads(session: Session, app: String = "", status: String = ""): Reply {
    val query = buildString {
      append("?limit=100")
      if (app.isNotBlank()) append("&app=").append(app)
      if (status.isNotBlank()) append("&status=").append(status)
    }
    return call(session, "/api/v1/admin/support/threads$query")
  }

  fun supportThread(session: Session, threadId: String, after: Long = 0): Reply =
    call(session, "/api/v1/admin/support/threads/$threadId?after=$after")

  fun supportReply(session: Session, threadId: String, text: String): Reply {
    val body = JSONObject().put("body", text)
    return call(session, "/api/v1/admin/support/threads/$threadId/messages", "POST", body)
  }

  fun supportStatus(session: Session, threadId: String, status: String): Reply {
    val body = JSONObject().put("status", status)
    return call(session, "/api/v1/admin/support/threads/$threadId/status", "POST", body)
  }

  /* ------------------------------ خانه ---------------------------------- */

  fun dashboard(session: Session): Reply = call(session, "/api/dashboard")
}

data class SupportSection(val app: String, val title: String)

/** سه بخشِ پشتیبانی — همان‌ها که در نوارِ بالای صفحهٔ پشتیبانی دیده می‌شوند */
val SUPPORT_SECTIONS = listOf(
  SupportSection("station", "پمپ بنزین"),
  SupportSection("shop", "فروشگاه"),
  SupportSection("site", "سایت‌ها"),
)

/** ثانیه/دقیقه/ساعتِ خوانا — همه‌جای برنامه یک شکل */
object Ago {
  fun of(millis: Long): String {
    if (millis <= 0) return "—"
    val diff = System.currentTimeMillis() - millis
    if (diff < 0) return "همین حالا"
    val seconds = TimeUnit.MILLISECONDS.toSeconds(diff)
    if (seconds < 60) return "همین حالا"
    val minutes = TimeUnit.MILLISECONDS.toMinutes(diff)
    if (minutes < 60) return "$minutes دقیقه پیش"
    val hours = TimeUnit.MILLISECONDS.toHours(diff)
    if (hours < 24) return "$hours ساعت پیش"
    val days = TimeUnit.MILLISECONDS.toDays(diff)
    if (days < 30) return "$days روز پیش"
    return "${days / 30} ماه پیش"
  }
}
