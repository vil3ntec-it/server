package ir.vil3ntec.admin.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import ir.vil3ntec.admin.data.SessionStore

/**
 *  گوشی که روشن شد — یا برنامه که به‌روز شد — نگهبان هم باید برگردد.
 *
 *  ⚠️ بدونِ این، «تا برنامه بسته هم خبرم کن» فقط تا اولین ری‌استارت کار
 *  می‌کرد و بعد بی‌صدا می‌مرد. آدم هم نمی‌فهمید: نه خطایی، نه پیامی، فقط
 *  دیگر خبری نمی‌آمد.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return

    val store = SessionStore(context.applicationContext)
    if (store.load().loggedIn && store.watchEnabled) {
      runCatching { WatchService.start(context.applicationContext) }
    }
  }
}
