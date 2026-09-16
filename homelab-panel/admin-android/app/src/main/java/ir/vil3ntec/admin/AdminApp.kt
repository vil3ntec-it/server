package ir.vil3ntec.admin

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import ir.vil3ntec.admin.data.SessionStore
import ir.vil3ntec.admin.work.WatchService

class AdminApp : Application() {

  lateinit var store: SessionStore
    private set

  override fun onCreate() {
    super.onCreate()
    store = SessionStore(this)
    createChannels()

    // اگر از قبل وارد شده و نگهبان روشن است، با بالا آمدنِ برنامه هم روشن شود
    if (store.load().loggedIn && store.watchEnabled) {
      runCatching { WatchService.start(this) }
    }
  }

  /*
   *  دو کانالِ جدا، چون دو چیزِ متفاوت‌اند و کاربر باید بتواند یکی را
   *  ساکت کند بی‌آنکه دیگری را از دست بدهد:
   *
   *    پیام‌ها  →  پیامِ تازهٔ پشتیبانی. باید صدا بدهد.
   *    نگهبان   →  اعلانِ همیشگیِ سرویس. بی‌صدا و کم‌اهمیت، فقط برای اینکه
   *                اندروید اجازه دهد سرویس زنده بماند.
   */
  private fun createChannels() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val manager = getSystemService(NotificationManager::class.java) ?: return

    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_MESSAGES, "پیام‌های پشتیبانی", NotificationManager.IMPORTANCE_HIGH)
        .apply { description = "وقتی مشتری پیام تازه می‌فرستد" }
    )
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_WATCH, "نگهبان", NotificationManager.IMPORTANCE_MIN)
        .apply { description = "تا برنامه بسته هم پیام‌ها را ببیند" }
    )
    manager.createNotificationChannel(
      NotificationChannel(CHANNEL_UPDATE, "به‌روزرسانی", NotificationManager.IMPORTANCE_LOW)
        .apply { description = "دانلودِ نسخهٔ تازه" }
    )
  }

  companion object {
    const val CHANNEL_MESSAGES = "messages"
    const val CHANNEL_WATCH = "watch"
    const val CHANNEL_UPDATE = "update"
  }
}
