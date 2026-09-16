package ir.vil3ntec.admin.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** آدرسِ سرور، توکنِ ورود، و نامِ کسی که وارد شده */
data class Session(
  val serverUrl: String,
  val token: String?,
  val username: String,
  val role: String = "admin",
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

  fun load(): Session = Session(
    serverUrl = prefs.getString(KEY_URL, "").orEmpty(),
    token = prefs.getString(KEY_TOKEN, null),
    username = prefs.getString(KEY_USER, "").orEmpty(),
    role = prefs.getString(KEY_ROLE, "admin").orEmpty(),
  )

  fun save(session: Session) {
    prefs.edit()
      .putString(KEY_URL, session.serverUrl)
      .putString(KEY_TOKEN, session.token)
      .putString(KEY_USER, session.username)
      .putString(KEY_ROLE, session.role)
      .apply()
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

  private companion object {
    const val KEY_URL = "server_url"
    const val KEY_TOKEN = "token"
    const val KEY_USER = "username"
    const val KEY_ROLE = "role"
    const val KEY_LAST_MESSAGE = "last_message"
    const val KEY_WATCH = "watch_enabled"
  }
}
