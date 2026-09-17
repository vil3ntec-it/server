package ir.vil3ntec.admin.work

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import ir.vil3ntec.admin.AdminApp
import ir.vil3ntec.admin.MainActivity
import ir.vil3ntec.admin.R
import ir.vil3ntec.admin.data.Api
import ir.vil3ntec.admin.data.SUPPORT_SECTIONS
import ir.vil3ntec.admin.data.Session
import ir.vil3ntec.admin.data.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 *  نگهبانِ پیام‌ها — «تا برنامه بسته هم باشد، خبرم کن».
 *
 *  ⚠️ چرا سرویسِ پیش‌زمینه و نه پوشِ گوگل: پوش یعنی حسابِ Firebase، کلیدِ
 *  گوگل، و اینکه پیامِ مشتریِ شما اول از سرورِ گوگل رد شود. این سرور مالِ
 *  خودِ آدم است و در خانه‌اش بالا می‌آید؛ یک سرویسِ کوچک که خودش هر چند
 *  ثانیه از همان سرور می‌پرسد، هم ساده‌تر است هم چیزی از خانه بیرون نمی‌رود.
 *
 *  ⚠️ اعلانِ همیشگیِ «نگهبان روشن است» دور زدنی نیست: اندروید بدونِ آن،
 *  سرویس را چند دقیقه بعد می‌خواباند. کانالش کم‌اهمیت است تا در پایینِ
 *  فهرست و بی‌صدا بنشیند.
 */
class WatchService : Service() {

  private var job: Job? = null
  private val scope = CoroutineScope(Dispatchers.IO)

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    startForeground(ONGOING_ID, ongoingNotification())
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (job?.isActive != true) job = scope.launch { loop() }
    // اگر اندروید سرویس را کشت، خودش دوباره بالا بیاورد
    return START_STICKY
  }

  override fun onDestroy() {
    job?.cancel()
    scope.cancel()
    super.onDestroy()
  }

  private suspend fun loop() {
    val store = SessionStore(applicationContext)
    while (scope.isActive) {
      val session = store.load()
      if (!session.loggedIn || !store.watchEnabled) {
        delay(60_000)
        continue
      }
      runCatching { checkOnce(store, session) }
      delay(POLL_MS)
    }
  }

  /**
   * یک دور: هر سه بخش را می‌پرسد و پیامی که تازه‌تر از آخرین دیده‌شده است
   * را اعلان می‌دهد.
   *
   * ⚠️ «آخرین دیده‌شده» بر اساس زمانِ پیام است نه تعدادِ خوانده‌نشده‌ها:
   * اگر با تعداد می‌سنجیدیم، بازکردنِ گفت‌وگو در پنلِ وب شمارنده را صفر
   * می‌کرد و پیامِ بعدی دیگر اعلان نمی‌گرفت.
   */
  private fun checkOnce(store: SessionStore, session: Session) {
    var newest = store.lastSeenMessage
    var count = 0
    var sampleWho = ""
    var sampleText = ""
    var sampleSection = ""

    for (section in SUPPORT_SECTIONS) {
      val reply = Api.supportThreads(session, section.app)
      val threads = reply.items("threads")
      for (index in 0 until threads.length()) {
        val row = threads.optJSONObject(index) ?: JSONObject()
        val updatedAt = row.optLong("updatedAt")
        val unread = row.optInt("unreadAdmin")
        if (unread > 0 && updatedAt > store.lastSeenMessage) {
          count += unread
          if (updatedAt > newest) {
            newest = updatedAt
            sampleWho = row.optString("who")
            sampleText = row.optString("lastMessage")
            sampleSection = section.title
          }
        }
      }
    }

    if (count > 0 && newest > store.lastSeenMessage) {
      store.lastSeenMessage = newest
      notifyNew(count, sampleWho, sampleText, sampleSection)
    }
  }

  private fun notifyNew(count: Int, who: String, text: String, section: String) {
    val manager = getSystemService(NotificationManager::class.java) ?: return
    val open = PendingIntent.getActivity(
      this,
      0,
      Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val title = if (count == 1) "پیام تازه — $section" else "$count پیام تازه — $section"
    val body = buildString {
      if (who.isNotBlank()) append(who).append(": ")
      append(text.take(120))
    }.ifBlank { "برای دیدن، برنامه را باز کنید" }

    val notification = NotificationCompat.Builder(this, AdminApp.CHANNEL_MESSAGES)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle(title)
      .setContentText(body)
      .setStyle(NotificationCompat.BigTextStyle().bigText(body))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setContentIntent(open)
      .build()

    manager.notify(MESSAGE_ID, notification)
  }

  private fun ongoingNotification(): Notification =
    NotificationCompat.Builder(this, AdminApp.CHANNEL_WATCH)
      .setSmallIcon(R.mipmap.ic_launcher)
      .setContentTitle("نگهبانِ پیام‌ها روشن است")
      .setContentText("پیامِ تازهٔ پشتیبانی را همین‌جا خبر می‌دهد")
      .setPriority(NotificationCompat.PRIORITY_MIN)
      .setOngoing(true)
      .setSilent(true)
      .build()

  companion object {
    private const val ONGOING_ID = 1001
    private const val MESSAGE_ID = 1002

    /*
     *  هر ۲۰ ثانیه. کوتاه‌تر یعنی باتری، بلندتر یعنی جوابِ دیرِ مشتری.
     *  روی شبکهٔ خانگی این درخواست چند کیلوبایت است.
     */
    private const val POLL_MS = 20_000L

    fun start(context: Context) {
      val intent = Intent(context, WatchService::class.java)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    fun stop(context: Context) {
      context.stopService(Intent(context, WatchService::class.java))
    }
  }
}
