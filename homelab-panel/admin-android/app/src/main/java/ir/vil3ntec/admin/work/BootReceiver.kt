package ir.vil3ntec.admin.work

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import ir.vil3ntec.admin.data.SessionStore

/**
 *  گوشی که روشن شد — یا برنامه که به‌روز شد — نگهبان هم باید برگردد.
 *
 *  ⚠️ ولی نه به هر قیمتی، و این درسِ گران‌قیمتی بود.
 *
 *  از اندروید ۱۲ به بعد، شروعِ سرویسِ پیش‌زمینه از پس‌زمینه ممنوع است.
 *  بوت و «بسته به‌روز شد» هر دو پس‌زمینه‌اند. اندروید ۱۴ سخت‌گیرتر شد و
 *  اندروید ۱۵ نوعِ dataSync را از بوت هم رد می‌کند. نتیجه‌اش این بود که
 *  درست بعدِ نصبِ به‌روزرسانی، کادرِ «ویلن ادمین has stopped» می‌آمد —
 *  بی آنکه کاربر اصلاً برنامه را باز کرده باشد.
 *
 *  پس روی نسخه‌های تازه اصلاً تلاش نمی‌کنیم. نگهبان با اولین باز شدنِ
 *  برنامه برمی‌گردد. یک اعلانِ دیرتر، در برابرِ برنامه‌ای که می‌افتد.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return

    // اندروید ۱۲ به بالا: دست نمی‌زنیم. MainActivity خودش روشنش می‌کند.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) return

    val store = SessionStore(context.applicationContext)
    if (store.load().loggedIn && store.watchEnabled) {
      WatchService.start(context.applicationContext)
    }
  }
}
