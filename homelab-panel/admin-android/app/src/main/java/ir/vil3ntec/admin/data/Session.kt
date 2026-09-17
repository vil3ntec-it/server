package ir.vil3ntec.admin.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** آدرسِ سرور، توکنِ ورود، نامِ کسی که وارد شده، و راهِ بیرون از خانه */
data class Session(
  val serverUrl: String,
  val token: String?,
  val username: String,
  val role: String = "admin",
  /** دامنه و کلیدِ درِ مدیر — برای وقتی که روی وای‌فایِ خانه نیستید */
  val remote: RemoteAccess? = null,
) {
  val loggedIn: Boolean get() = !token.isNullOrBlank() && serverUrl.isNotBlank()
}

/**
 *  نگهداریِ نشست روی گوشی.
 *
 *  ⚠️ توکن رمزنگاری‌شده ذخیره می‌شود. توکنِ مدیرِ پنل یعنی دسترسی کامل به
 *  سرور؛ اگر ساده در SharedPreferences می‌نشست، هر برنامهٔ دیگری روی یک
 *  گوشیِ روت‌شده می‌توانست برش دارد.
 *
 *  ⚠️ اگر رمزنگاری بالا نیامد (گوشی‌های قدیمی و کلیدِ خرابِ Keystore)،
 *  برنامه نباید بیفتد: به حافظهٔ ساده برمی‌گردد. ورودِ دوباره بهتر از
 *  برنامه‌ای است که اصلاً باز نمی‌شود.
 */
class SessionStore(context: Context) {

  private val prefs: SharedPreferences = runCatching {
    val key = MasterKey.Builder(context)
      .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
      .build()
    EncryptedSharedPreferences.create(
      context,
      "villain-admin-secure",
      key,
      EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
      EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
    ) as SharedPreferences
  }.getOrElse {
    context.getSharedPreferences("villain-admin", Context.MODE_PRIVATE)
  }

  fun load(): Session {
    val key = prefs.getString(KEY_GATE_KEY, "").orEmpty()
    val remoteUrl = prefs.getString(KEY_REMOTE_URL, "").orEmpty()
    return Session(
      serverUrl = prefs.getString(KEY_URL, "").orEmpty(),
      token = prefs.getString(KEY_TOKEN, null),
      username = prefs.getString(KEY_USER, "").orEmpty(),
      role = prefs.getString(KEY_ROLE, "admin").orEmpty(),
      remote = if (key.isBlank() || remoteUrl.isBlank()) null else RemoteAccess(
        url = remoteUrl,
        gatePath = prefs.getString(KEY_GATE_PATH, "/api/admin-gate").orEmpty(),
        gateHeader = prefs.getString(KEY_GATE_HEADER, "x-admin-gate").orEmpty(),
        key = key,
        deviceId = deviceId,
      ),
    )
  }

  fun save(session: Session) {
    prefs.edit()
      .putString(KEY_URL, session.serverUrl)
      .putString(KEY_TOKEN, session.token)
      .putString(KEY_USER, session.username)
      .putString(KEY_ROLE, session.role)
      .apply()
    session.remote?.let { saveRemote(it) }
  }

  /**
   * دامنه و کلیدِ در.
   *
   * ⚠️ کلید مثلِ رمز است — هر کس داشته باشدش، درِ سرور از اینترنت برایش باز
   * می‌شود. برای همین در همان حافظهٔ رمزنگاری‌شده می‌نشیند و هیچ‌جای دیگری
   * نوشته یا لاگ نمی‌شود.
   */
  fun saveRemote(remote: RemoteAccess) {
    prefs.edit()
      .putString(KEY_REMOTE_URL, remote.url)
      .putString(KEY_GATE_PATH, remote.gatePath)
      .putString(KEY_GATE_HEADER, remote.gateHeader)
      .putString(KEY_GATE_KEY, remote.key)
      .putString(KEY_DEVICE, remote.deviceId)
      .apply()
  }

  fun clearRemote() {
    prefs.edit()
      .remove(KEY_REMOTE_URL)
      .remove(KEY_GATE_KEY)
      .apply()
  }

  /**
   * شناسهٔ همین گوشی — یک بار ساخته می‌شود و می‌ماند.
   *
   * کلیدِ در به همین بسته است، تا اگر گوشی گم شد بشود از پنل همین یکی را
   * باطل کرد بی‌آنکه بقیه از کار بیفتند.
   */
  val deviceId: String
    get() {
      prefs.getString(KEY_DEVICE, null)?.let { if (it.isNotBlank()) return it }
      val fresh = "phone-" + java.util.UUID.randomUUID().toString().take(8)
      prefs.edit().putString(KEY_DEVICE, fresh).apply()
      return fresh
    }

  /** خروج — آدرسِ سرور می‌ماند تا بارِ بعد دوباره تایپ نشود */
  fun clearToken() {
    prefs.edit().remove(KEY_TOKEN).apply()
  }

  /** آخرین شناسهٔ پیامی که اعلانش داده شده — تا یک پیام دو بار زنگ نزند */
  var lastSeenMessage: Long
    get() = prefs.getLong(KEY_LAST_MESSAGE, 0L)
    set(value) = prefs.edit().putLong(KEY_LAST_MESSAGE, value).apply()

  /** نگهبانِ پیام‌ها روشن باشد؟ */
  var watchEnabled: Boolean
    get() = prefs.getBoolean(KEY_WATCH, true)
    set(value) = prefs.edit().putBoolean(KEY_WATCH, value).apply()

  /**
   * روشن، تاریک، یا هرچه گوشی می‌گوید.
   *
   * ⚠️ این‌جا ذخیره می‌شود نه در حافظهٔ موقت: تمی که با هر بار بستنِ برنامه
   * برگردد سرِ جای اولش، از نبودنش هم بدتر است.
   */
  var themeMode: String
    get() = prefs.getString(KEY_THEME, "system").orEmpty()
    set(value) = prefs.edit().putString(KEY_THEME, value).apply()

  private companion object {
    const val KEY_URL = "server_url"
    const val KEY_TOKEN = "token"
    const val KEY_USER = "username"
    const val KEY_ROLE = "role"
    const val KEY_LAST_MESSAGE = "last_message"
    const val KEY_WATCH = "watch_enabled"
    const val KEY_THEME = "theme_mode"
    const val KEY_REMOTE_URL = "remote_url"
    const val KEY_GATE_PATH = "gate_path"
    const val KEY_GATE_HEADER = "gate_header"
    const val KEY_GATE_KEY = "gate_key"
    const val KEY_DEVICE = "device_id"
  }
}
